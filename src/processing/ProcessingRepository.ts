import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Database } from '../storage/Database.js';
import { executionOwner, ownerAlive } from '../acquisition/ExecutionOwner.js';
import { fail } from '../domain/ModelsError.js';
import type {
  ProcessingJob,
  ProcessingKind,
  ProcessingSettings,
  ProcessingProgress,
  ProcessingStatus,
} from './types.js';

export const processingSettingsSchema = z
  .object({
    propertySetMode: z.enum(['embedded', 'external']).default('embedded'),
    automaticIFC: z.boolean(),
    paused: z.boolean(),
    memoryLimitMiB: z.number().int().min(256).max(65536),
    reserveMemoryMiB: z.number().int().min(256).max(65536),
    cpuCores: z.number().int().min(1).max(4),
    timeoutMinutes: z.number().int().min(1).max(1440),
  })
  .strict();
const columns = `j.id,j.model_id modelId,m.name modelName,j.kind,j.format,j.status,j.source,j.phase,
 j.created_at createdAt,j.started_at startedAt,j.completed_at completedAt,j.heartbeat_at heartbeatAt,
 j.memory_bytes memoryBytes,j.cpu_percent cpuPercent,j.error_code errorCode,j.error_message error`;

/**
 * Claims and cancellation use SQLite, so two server processes cannot run two workers.
 * A missing heartbeat alone never allows another process to steal a live job.
 */
export class ProcessingRepository {
  readonly owner = executionOwner();
  constructor(readonly db: Database) {}
  settings(): ProcessingSettings {
    return processingSettingsSchema.parse(
      JSON.parse(
        this.db.sql.prepare('SELECT settings_json FROM processing_settings WHERE id=1').get()!
          .settings_json as string,
      ),
    );
  }
  configure(patch: Partial<ProcessingSettings>) {
    const parsed = processingSettingsSchema.partial().safeParse(patch);
    if (!parsed.success) fail('INVALID_MODEL', 'Processing settings: invalid value');
    return this.db.transaction(() => {
      const settings = { ...this.settings(), ...parsed.data };
      this.db.sql
        .prepare('UPDATE processing_settings SET settings_json=? WHERE id=1')
        .run(JSON.stringify(settings));
      return settings;
    });
  }
  get(id: string): ProcessingJob | null {
    return (
      (this.db.sql
        .prepare(
          `SELECT ${columns} FROM processing_jobs j JOIN models m ON m.id=j.model_id WHERE j.id=?`,
        )
        .get(id) as unknown as ProcessingJob) ?? null
    );
  }
  list(modelId?: string) {
    return this.db.sql
      .prepare(
        `SELECT ${columns} FROM processing_jobs j JOIN models m ON m.id=j.model_id ${modelId ? 'WHERE j.model_id=?' : ''}
      ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'cancelling' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,j.created_at DESC,j.id LIMIT 100`,
      )
      .all(...(modelId ? [modelId] : [])) as unknown as ProcessingJob[];
  }
  counts() {
    const counts: Record<ProcessingStatus, number> = {
      queued: 0,
      running: 0,
      cancelling: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    };
    for (const row of this.db.sql
      .prepare('SELECT status,count(*) n FROM processing_jobs GROUP BY status')
      .all())
      counts[row.status as ProcessingStatus] = Number(row.n);
    return counts;
  }

  /**
   * The caller owns the transaction, including when an import schedules its IFC.
   */
  enqueue(
    modelId: string,
    kind: ProcessingKind,
    format: string,
    source: 'automatic' | 'requested',
  ) {
    const existing = this.db.sql
      .prepare(
        "SELECT id FROM processing_jobs WHERE model_id=? AND kind=? AND format=? AND status IN ('queued','running','cancelling')",
      )
      .get(modelId, kind, format);
    if (existing) {
      if (source === 'requested')
        this.db.sql
          .prepare("UPDATE processing_jobs SET source='requested' WHERE id=?")
          .run(existing.id!);
      return this.get(existing.id as string)!;
    }
    const id = randomUUID();
    this.db.sql
      .prepare(
        "INSERT INTO processing_jobs(id,model_id,kind,format,status,source,phase,created_at) VALUES(?,?,?,?,'queued',?,'Queued',?)",
      )
      .run(id, modelId, kind, format, source, new Date().toISOString());
    return this.get(id)!;
  }
  recover() {
    for (const row of this.db.sql
      .prepare("SELECT id,owner_json FROM processing_jobs WHERE status IN ('running','cancelling')")
      .all()) {
      if (row.owner_json && !ownerAlive(JSON.parse(row.owner_json as string)))
        this.db.sql
          .prepare(
            "UPDATE processing_jobs SET status='interrupted',phase='Interrupted',owner_json=NULL,completed_at=?,error_code='CONVERSION_FAILED',error_message='The worker owner stopped. Retry to continue.' WHERE id=?",
          )
          .run(new Date().toISOString(), row.id!);
    }
  }
  claim(jobId?: string): ProcessingJob | null {
    return this.db.transaction(() => {
      this.recover();
      const settings = this.settings();
      if (settings.paused || os.freemem() < settings.reserveMemoryMiB * 1024 ** 2) return null;
      if (
        this.db.sql
          .prepare(
            "SELECT id FROM processing_jobs WHERE status IN ('running','cancelling') LIMIT 1",
          )
          .get()
      )
        return null;
      const row = this.db.sql
        .prepare(
          "SELECT id FROM processing_jobs WHERE status='queued' AND (source='requested' OR ?=1) AND (? IS NULL OR id=?) ORDER BY CASE source WHEN 'requested' THEN 0 ELSE 1 END,created_at,id LIMIT 1",
        )
        .get(Number(settings.automaticIFC), jobId ?? null, jobId ?? null);
      if (!row) return null;
      const now = new Date().toISOString();
      this.db.sql
        .prepare(
          "UPDATE processing_jobs SET status='running',phase='Starting',owner_json=?,started_at=?,heartbeat_at=?,completed_at=NULL WHERE id=?",
        )
        .run(JSON.stringify(this.owner), now, now, row.id!);
      return this.get(row.id as string);
    });
  }
  progress(id: string, progress: ProcessingProgress = {}) {
    this.db.sql
      .prepare(
        `UPDATE processing_jobs SET heartbeat_at=?,phase=COALESCE(?,phase),memory_bytes=COALESCE(?,memory_bytes),cpu_percent=COALESCE(?,cpu_percent)
      WHERE id=? AND json_extract(owner_json,'$.token')=?`,
      )
      .run(
        new Date().toISOString(),
        progress.phase ?? null,
        progress.memoryBytes ?? null,
        progress.cpuPercent ?? null,
        id,
        this.owner.token,
      );
  }
  finish(id: string, status: ProcessingStatus, code?: string, message?: string) {
    this.db.sql
      .prepare(
        `UPDATE processing_jobs SET status=?,phase=?,completed_at=?,owner_json=NULL,error_code=?,error_message=?
      WHERE id=? AND json_extract(owner_json,'$.token')=?`,
      )
      .run(
        status,
        status[0].toUpperCase() + status.slice(1),
        new Date().toISOString(),
        code ?? null,
        message ?? null,
        id,
        this.owner.token,
      );
  }
  cancel(id: string) {
    return this.db.transaction(() => {
      const job = this.get(id) ?? fail('JOB_NOT_FOUND', 'Cancel conversion: job does not exist');
      if (job.status === 'queued')
        this.db.sql
          .prepare(
            "UPDATE processing_jobs SET status='cancelled',phase='Cancelled',completed_at=? WHERE id=?",
          )
          .run(new Date().toISOString(), id);
      else if (job.status === 'running')
        this.db.sql
          .prepare("UPDATE processing_jobs SET status='cancelling',phase='Cancelling' WHERE id=?")
          .run(id);
    });
  }
}
