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
const columns = `j.id,j.model_id "modelId",m.name "modelName",j.kind,j.format,j.status,j.source,j.phase,
 j.created_at "createdAt",j.started_at "startedAt",j.completed_at "completedAt",j.heartbeat_at "heartbeatAt",
 j.memory_bytes "memoryBytes",j.cpu_percent "cpuPercent",j.error_code "errorCode",j.error_message error`;

/**
 * Claims and cancellation use PostgreSQL, so two server processes cannot run two workers.
 * A missing heartbeat alone never allows another process to steal a live job.
 */
export class ProcessingRepository {
  readonly owner = executionOwner();
  constructor(readonly db: Database) {}
  async settings(): Promise<ProcessingSettings> {
    return processingSettingsSchema.parse(
      JSON.parse(
        (await this.db.one('SELECT settings_json FROM processing_settings WHERE id=1', []))!
          .settings_json as string,
      ),
    );
  }
  async configure(patch: Partial<ProcessingSettings>) {
    const parsed = processingSettingsSchema.partial().safeParse(patch);
    if (!parsed.success) fail('INVALID_MODEL', 'Processing settings: invalid value');
    return await this.db.transaction(async () => {
      await this.db.lock('processing-admission');
      const settings = { ...(await this.settings()), ...parsed.data };
      await this.db.query('UPDATE processing_settings SET settings_json=$1 WHERE id=1', [
        JSON.stringify(settings),
      ]);
      return settings;
    });
  }
  async get(id: string): Promise<ProcessingJob | null> {
    return (
      ((await this.db.one(
        `SELECT ${columns} FROM processing_jobs j JOIN models m ON m.id=j.model_id WHERE j.id=$1`,
        [id],
      )) as unknown as ProcessingJob) ?? null
    );
  }
  async list(modelId?: string) {
    return (await this.db.all(
      `SELECT ${columns} FROM processing_jobs j JOIN models m ON m.id=j.model_id ${modelId ? 'WHERE j.model_id=$1' : ''}
      ORDER BY CASE j.status WHEN 'running' THEN 0 WHEN 'cancelling' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,j.created_at DESC,j.id LIMIT 100`,
      [...(modelId ? [modelId] : [])],
    )) as unknown as ProcessingJob[];
  }
  async counts() {
    const counts: Record<ProcessingStatus, number> = {
      queued: 0,
      running: 0,
      cancelling: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    };
    for (const row of await this.db.all(
      'SELECT status,count(*) n FROM processing_jobs GROUP BY status',
      [],
    ))
      counts[row.status as ProcessingStatus] = Number(row.n);
    return counts;
  }

  /**
   * The caller owns the transaction, including when an import schedules its IFC.
   */
  async enqueue(
    modelId: string,
    kind: ProcessingKind,
    format: string,
    source: 'automatic' | 'requested',
  ) {
    await this.db.lock('processing-admission');
    const existing = await this.db.one(
      "SELECT id FROM processing_jobs WHERE model_id=$1 AND kind=$2 AND format=$3 AND status IN ('queued','running','cancelling')",
      [modelId, kind, format],
    );
    if (existing) {
      if (source === 'requested')
        await this.db.query("UPDATE processing_jobs SET source='requested' WHERE id=$1", [
          existing.id!,
        ]);
      return (await this.get(existing.id as string))!;
    }
    const id = randomUUID();
    await this.db.query(
      "INSERT INTO processing_jobs(id,model_id,kind,format,status,source,phase,created_at) VALUES($1,$2,$3,$4,'queued',$5,'Queued',$6)",
      [id, modelId, kind, format, source, new Date().toISOString()],
    );
    return (await this.get(id))!;
  }
  async recover() {
    for (const row of await this.db.all(
      "SELECT id,owner_json FROM processing_jobs WHERE status IN ('running','cancelling')",
      [],
    )) {
      if (row.owner_json && !ownerAlive(JSON.parse(row.owner_json as string)))
        await this.db.query(
          "UPDATE processing_jobs SET status='interrupted',phase='Interrupted',owner_json=NULL,completed_at=$1,error_code='CONVERSION_FAILED',error_message='The worker owner stopped. Retry to continue.' WHERE id=$2",
          [new Date().toISOString(), row.id!],
        );
    }
  }
  async claim(jobId?: string): Promise<ProcessingJob | null> {
    return await this.db.transaction(async () => {
      await this.db.lock('processing-admission');
      await this.recover();
      const settings = await this.settings();
      if (settings.paused || os.freemem() < settings.reserveMemoryMiB * 1024 ** 2) return null;
      if (
        await this.db.one(
          "SELECT id FROM processing_jobs WHERE status IN ('running','cancelling') LIMIT 1",
          [],
        )
      )
        return null;
      const row = await this.db.one(
        "SELECT id FROM processing_jobs WHERE status='queued' AND (source='requested' OR $1=1) AND ($2::text IS NULL OR id=$3) ORDER BY CASE source WHEN 'requested' THEN 0 ELSE 1 END,created_at,id LIMIT 1",
        [Number(settings.automaticIFC), jobId ?? null, jobId ?? null],
      );
      if (!row) return null;
      const now = new Date().toISOString();
      await this.db.query(
        "UPDATE processing_jobs SET status='running',phase='Starting',owner_json=$1,started_at=$2,heartbeat_at=$3,completed_at=NULL WHERE id=$4",
        [JSON.stringify(this.owner), now, now, row.id!],
      );
      return await this.get(row.id as string);
    });
  }
  async progress(id: string, progress: ProcessingProgress = {}) {
    await this.db.query(
      "UPDATE processing_jobs SET heartbeat_at=$1,phase=COALESCE($2,phase),memory_bytes=COALESCE($3,memory_bytes),cpu_percent=COALESCE($4,cpu_percent)\n      WHERE id=$5 AND (owner_json::json->>'token')=$6",
      [
        new Date().toISOString(),
        progress.phase ?? null,
        progress.memoryBytes ?? null,
        progress.cpuPercent ?? null,
        id,
        this.owner.token,
      ],
    );
  }
  async finish(id: string, status: ProcessingStatus, code?: string, message?: string) {
    await this.db.query(
      "UPDATE processing_jobs SET status=$1,phase=$2,completed_at=$3,owner_json=NULL,error_code=$4,error_message=$5\n      WHERE id=$6 AND (owner_json::json->>'token')=$7",
      [
        status,
        status[0].toUpperCase() + status.slice(1),
        new Date().toISOString(),
        code ?? null,
        message ?? null,
        id,
        this.owner.token,
      ],
    );
  }
  async cancel(id: string) {
    return await this.db.transaction(async () => {
      await this.db.lock('processing-admission');
      const job =
        (await this.get(id)) ?? fail('JOB_NOT_FOUND', 'Cancel conversion: job does not exist');
      if (job.status === 'queued')
        await this.db.query(
          "UPDATE processing_jobs SET status='cancelled',phase='Cancelled',completed_at=$1 WHERE id=$2",
          [new Date().toISOString(), id],
        );
      else if (job.status === 'running')
        await this.db.query(
          "UPDATE processing_jobs SET status='cancelling',phase='Cancelling' WHERE id=$1",
          [id],
        );
    });
  }
}
