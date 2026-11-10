import { randomUUID } from 'node:crypto';
import { Database } from '../storage/Database.js';
import { fail } from '../domain/ModelsError.js';
import { executionOwner, ownerAlive } from './ExecutionOwner.js';
import { pageQuery } from './AcquisitionPlanRepository.js';
import type {
  AcquisitionPlan,
  AcquisitionJob,
  AcquisitionJobItem,
  AcquisitionJobItemStatus,
  AcquisitionJobStatus,
  ExecutionOptions,
  PlanListQuery,
} from './types.js';
export class AcquisitionJobRepository {
  readonly owner = executionOwner();
  constructor(readonly db: Database) {}
  recover() {
    this.db.transaction(() => {
      for (const row of this.db.sql
        .prepare("SELECT id,owner_json FROM acquisition_jobs WHERE status='running'")
        .all())
        if (row.owner_json && !ownerAlive(JSON.parse(row.owner_json as string)))
          this.db.sql
            .prepare("UPDATE acquisition_jobs SET status='interrupted',owner_json=NULL WHERE id=?")
            .run(row.id);
    });
  }
  create(plan: AcquisitionPlan, options: ExecutionOptions) {
    return this.db.transaction(() => {
      const id = randomUUID(),
        now = new Date().toISOString();
      this.db.sql
        .prepare(
          "INSERT INTO acquisition_jobs(id,plan_id,status,created_at,options_json) VALUES(?,?,'pending',?,?)",
        )
        .run(
          id,
          plan.id,
          now,
          JSON.stringify({
            concurrency: options.concurrency ?? 2,
            continueOnError: options.continueOnError ?? true,
          }),
        );
      for (const item of plan.items)
        this.db.sql
          .prepare(
            "INSERT INTO acquisition_job_items(id,job_id,plan_item_id,status) VALUES(?,?,?,'pending')",
          )
          .run(randomUUID(), id, item.id);
      return this.require(id);
    });
  }
  get(id: string): AcquisitionJob | null {
    const r = this.db.sql.prepare('SELECT * FROM acquisition_jobs WHERE id=?').get(id);
    if (!r) return null;
    const items = this.items(id);
    return {
      id: r.id as string,
      planId: r.plan_id as string,
      status: r.status as AcquisitionJobStatus,
      createdAt: r.created_at as string,
      startedAt: (r.started_at as string) ?? undefined,
      completedAt: (r.completed_at as string) ?? undefined,
      downloadedBytes: Number(r.downloaded_bytes),
      totalItems: items.length,
      completedItems: items.filter((i) => i.status === 'completed').length,
      failedItems: items.filter((i) => ['failed', 'stale'].includes(i.status)).length,
      skippedItems: items.filter((i) => i.status === 'skipped').length,
    };
  }
  require(id: string) {
    const j = this.get(id);
    if (!j) fail('JOB_NOT_FOUND', 'Acquisition job: job does not exist');
    return j;
  }
  items(id: string): AcquisitionJobItem[] {
    return this.db.sql
      .prepare(
        'SELECT j.*,p.model_name,p.provider,p.remote_asset_id,p.resolution,p.format FROM acquisition_job_items j JOIN acquisition_plan_items p ON p.id=j.plan_item_id WHERE j.job_id=? ORDER BY p.ordinal',
      )
      .all(id)
      .map((r) => ({
        id: r.id as string,
        jobId: id,
        planItemId: r.plan_item_id as string,
        modelName: r.model_name as string,
        provider: r.provider as AcquisitionJobItem['provider'],
        remoteId: r.remote_asset_id as string,
        resolution: r.resolution as string,
        format: r.format as string,
        status: r.status as AcquisitionJobItemStatus,
        attempts: Number(r.attempts),
        downloadedBytes: Number(r.downloaded_bytes),
        modelId: (r.model_id as string) ?? undefined,
        errorCode: (r.error_code as string) ?? undefined,
        errorMessage: (r.error_message as string) ?? undefined,
        startedAt: (r.started_at as string) ?? undefined,
        completedAt: (r.completed_at as string) ?? undefined,
        warnings: JSON.parse(r.warnings_json as string),
      }));
  }
  list(q: PlanListQuery = {}) {
    const { limit, offset } = pageQuery(q);
    return {
      items: this.db.sql
        .prepare('SELECT id FROM acquisition_jobs ORDER BY created_at DESC,id LIMIT ? OFFSET ?')
        .all(limit, offset)
        .map((r) => this.require(r.id as string)),
      total: Number(this.db.sql.prepare('SELECT count(*) AS n FROM acquisition_jobs').get()!.n),
      limit,
      offset,
    };
  }
  options(id: string): ExecutionOptions {
    this.require(id);
    return JSON.parse(
      this.db.sql.prepare('SELECT options_json FROM acquisition_jobs WHERE id=?').get(id)!
        .options_json as string,
    );
  }
  claim(id: string) {
    this.db.transaction(() => {
      const job = this.require(id);
      if (job.status === 'running')
        fail('JOB_CONFLICT', 'Execute job: another execution owns this job');
      if (job.status === 'completed')
        fail('JOB_CONFLICT', 'Resume job: execution is already finished');
      this.db.sql
        .prepare(
          "UPDATE acquisition_jobs SET status='running',owner_json=?,cancel_requested=0,started_at=COALESCE(started_at,?),completed_at=NULL WHERE id=?",
        )
        .run(JSON.stringify(this.owner), new Date().toISOString(), id);
      this.db.sql
        .prepare(
          "UPDATE acquisition_job_items SET status='pending',error_code=NULL,error_message=NULL,completed_at=NULL WHERE job_id=? AND status NOT IN ('completed','skipped')",
        )
        .run(id);
    });
  }
  check(id: string) {
    const row = this.db.sql
      .prepare('SELECT status,owner_json,cancel_requested FROM acquisition_jobs WHERE id=?')
      .get(id);
    if (
      !row ||
      row.status !== 'running' ||
      JSON.parse(row.owner_json as string).token !== this.owner.token
    )
      fail('JOB_CONFLICT', 'Execute job: ownership changed');
    if (row.cancel_requested) fail('DOWNLOAD_CANCELLED', 'Execute job: cancellation requested');
  }
  cancel(id: string) {
    this.db.transaction(() => {
      const job = this.require(id);
      if (job.status === 'running')
        this.db.sql.prepare('UPDATE acquisition_jobs SET cancel_requested=1 WHERE id=?').run(id);
      else if (job.status !== 'completed') {
        this.db.sql
          .prepare(
            "UPDATE acquisition_jobs SET status='cancelled',cancel_requested=1,completed_at=? WHERE id=?",
          )
          .run(new Date().toISOString(), id);
        this.db.sql
          .prepare(
            "UPDATE acquisition_job_items SET status='cancelled' WHERE job_id=? AND status NOT IN ('completed','skipped')",
          )
          .run(id);
      }
    });
  }
  begin(jobId: string, itemId: string) {
    this.db.transaction(() => {
      this.check(jobId);
      this.db.sql
        .prepare(
          "UPDATE acquisition_job_items SET attempts=attempts+1,status='downloading',started_at=?,completed_at=NULL WHERE id=? AND job_id=?",
        )
        .run(new Date().toISOString(), itemId, jobId);
    });
  }
  status(
    itemId: string,
    status: AcquisitionJobItemStatus,
    error?: { code: string; message: string },
  ) {
    this.db.transaction(() =>
      this.db.sql
        .prepare(
          'UPDATE acquisition_job_items SET status=?,error_code=?,error_message=?,completed_at=? WHERE id=?',
        )
        .run(
          status,
          error?.code ?? null,
          error?.message ?? null,
          ['failed', 'stale', 'cancelled', 'skipped', 'completed'].includes(status)
            ? new Date().toISOString()
            : null,
          itemId,
        ),
    );
  }
  transferred(jobId: string, itemId: string, bytes: number, limit: number) {
    // Count received bytes even on a failed attempt. Never reset these counters on resume.
    const total = this.db.transaction(() => {
      this.check(jobId);
      this.db.sql
        .prepare('UPDATE acquisition_jobs SET downloaded_bytes=downloaded_bytes+? WHERE id=?')
        .run(bytes, jobId);
      this.db.sql
        .prepare(
          'UPDATE acquisition_job_items SET downloaded_bytes=downloaded_bytes+? WHERE id=? AND job_id=?',
        )
        .run(bytes, itemId, jobId);
      return this.require(jobId).downloadedBytes;
    });
    if (total > limit)
      fail('ACQUISITION_LIMIT_EXCEEDED', 'Download: acquisition transfer budget exhausted');
  }
  finish(id: string, status: AcquisitionJobStatus) {
    this.db.transaction(() => {
      const row = this.db.sql.prepare('SELECT owner_json FROM acquisition_jobs WHERE id=?').get(id);
      if (row?.owner_json && JSON.parse(row.owner_json as string).token !== this.owner.token)
        fail('JOB_CONFLICT', 'Finish job: another execution owns the job');
      this.db.sql
        .prepare('UPDATE acquisition_jobs SET status=?,owner_json=NULL,completed_at=? WHERE id=?')
        .run(status, new Date().toISOString(), id);
    });
  }
}
