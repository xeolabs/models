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
  async recover() {
    await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      for (const row of await this.db.all(
        "SELECT id,owner_json FROM acquisition_jobs WHERE status='running'",
        [],
      ))
        if (row.owner_json && !ownerAlive(JSON.parse(row.owner_json as string)))
          await this.db.query(
            "UPDATE acquisition_jobs SET status='interrupted',owner_json=NULL WHERE id=$1",
            [row.id],
          );
    });
  }
  async create(plan: AcquisitionPlan, options: ExecutionOptions) {
    return await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      const id = randomUUID(),
        now = new Date().toISOString();
      await this.db.query(
        "INSERT INTO acquisition_jobs(id,plan_id,status,created_at,options_json) VALUES($1,$2,'pending',$3,$4)",
        [
          id,
          plan.id,
          now,
          JSON.stringify({
            concurrency: options.concurrency ?? 2,
            continueOnError: options.continueOnError ?? true,
          }),
        ],
      );
      for (const item of plan.items)
        await this.db.query(
          "INSERT INTO acquisition_job_items(id,job_id,plan_item_id,status) VALUES($1,$2,$3,'pending')",
          [randomUUID(), id, item.id],
        );
      return await this.require(id);
    });
  }
  async get(id: string): Promise<AcquisitionJob | null> {
    const r = await this.db.one('SELECT * FROM acquisition_jobs WHERE id=$1', [id]);
    if (!r) return null;
    const items = await this.items(id);
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
  async require(id: string) {
    const j = await this.get(id);
    if (!j) fail('JOB_NOT_FOUND', 'Acquisition job: job does not exist');
    return j;
  }
  async items(id: string): Promise<AcquisitionJobItem[]> {
    return (
      await this.db.all(
        'SELECT j.*,p.model_name,p.provider,p.remote_asset_id,p.resolution,p.format FROM acquisition_job_items j JOIN acquisition_plan_items p ON p.id=j.plan_item_id WHERE j.job_id=$1 ORDER BY p.ordinal',
        [id],
      )
    ).map((r) => ({
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
  async list(q: PlanListQuery = {}) {
    const { limit, offset } = pageQuery(q);
    return {
      items: await Promise.all(
        (
          await this.db.all(
            'SELECT id FROM acquisition_jobs ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',
            [limit, offset],
          )
        ).map(async (r) => await this.require(r.id as string)),
      ),
      total: Number((await this.db.one('SELECT count(*) AS n FROM acquisition_jobs', []))!.n),
      limit,
      offset,
    };
  }
  async options(id: string): Promise<ExecutionOptions> {
    await this.require(id);
    return JSON.parse(
      (await this.db.one('SELECT options_json FROM acquisition_jobs WHERE id=$1', [id]))!
        .options_json as string,
    );
  }
  async claim(id: string) {
    await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      const job = await this.require(id);
      if (job.status === 'running')
        fail('JOB_CONFLICT', 'Execute job: another execution owns this job');
      if (job.status === 'completed')
        fail('JOB_CONFLICT', 'Resume job: execution is already finished');
      await this.db.query(
        "UPDATE acquisition_jobs SET status='running',owner_json=$1,cancel_requested=0,started_at=COALESCE(started_at,$2),completed_at=NULL WHERE id=$3",
        [JSON.stringify(this.owner), new Date().toISOString(), id],
      );
      await this.db.query(
        "UPDATE acquisition_job_items SET status='pending',error_code=NULL,error_message=NULL,completed_at=NULL WHERE job_id=$1 AND status NOT IN ('completed','skipped')",
        [id],
      );
    });
  }
  async check(id: string) {
    const row = await this.db.one(
      'SELECT status,owner_json,cancel_requested FROM acquisition_jobs WHERE id=$1',
      [id],
    );
    if (
      !row ||
      row.status !== 'running' ||
      JSON.parse(row.owner_json as string).token !== this.owner.token
    )
      fail('JOB_CONFLICT', 'Execute job: ownership changed');
    if (row.cancel_requested) fail('DOWNLOAD_CANCELLED', 'Execute job: cancellation requested');
  }
  async cancel(id: string) {
    await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      const job = await this.require(id);
      if (job.status === 'running')
        await this.db.query('UPDATE acquisition_jobs SET cancel_requested=1 WHERE id=$1', [id]);
      else if (job.status !== 'completed') {
        await this.db.query(
          "UPDATE acquisition_jobs SET status='cancelled',cancel_requested=1,completed_at=$1 WHERE id=$2",
          [new Date().toISOString(), id],
        );
        await this.db.query(
          "UPDATE acquisition_job_items SET status='cancelled' WHERE job_id=$1 AND status NOT IN ('completed','skipped')",
          [id],
        );
      }
    });
  }
  async begin(jobId: string, itemId: string) {
    await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      await this.check(jobId);
      await this.db.query(
        "UPDATE acquisition_job_items SET attempts=attempts+1,status='downloading',started_at=$1,completed_at=NULL WHERE id=$2 AND job_id=$3",
        [new Date().toISOString(), itemId, jobId],
      );
    });
  }
  async status(
    itemId: string,
    status: AcquisitionJobItemStatus,
    error?: { code: string; message: string },
  ) {
    await this.db.transaction(
      async () =>
        await this.db.query(
          'UPDATE acquisition_job_items SET status=$1,error_code=$2,error_message=$3,completed_at=$4 WHERE id=$5',
          [
            status,
            error?.code ?? null,
            error?.message ?? null,
            ['failed', 'stale', 'cancelled', 'skipped', 'completed'].includes(status)
              ? new Date().toISOString()
              : null,
            itemId,
          ],
        ),
    );
  }
  async transferred(jobId: string, itemId: string, bytes: number, limit: number) {
    // Count received bytes even on a failed attempt. Never reset these counters on resume.
    const total = await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      await this.check(jobId);
      await this.db.query(
        'UPDATE acquisition_jobs SET downloaded_bytes=downloaded_bytes+$1 WHERE id=$2',
        [bytes, jobId],
      );
      await this.db.query(
        'UPDATE acquisition_job_items SET downloaded_bytes=downloaded_bytes+$1 WHERE id=$2 AND job_id=$3',
        [bytes, itemId, jobId],
      );
      return (await this.require(jobId)).downloadedBytes;
    });
    if (total > limit)
      fail('ACQUISITION_LIMIT_EXCEEDED', 'Download: acquisition transfer budget exhausted');
  }
  async finish(id: string, status: AcquisitionJobStatus) {
    await this.db.transaction(async () => {
      await this.db.lock('acquisition-jobs');
      const row = await this.db.one('SELECT owner_json FROM acquisition_jobs WHERE id=$1', [id]);
      if (row?.owner_json && JSON.parse(row.owner_json as string).token !== this.owner.token)
        fail('JOB_CONFLICT', 'Finish job: another execution owns the job');
      await this.db.query(
        'UPDATE acquisition_jobs SET status=$1,owner_json=NULL,completed_at=$2 WHERE id=$3',
        [status, new Date().toISOString(), id],
      );
    });
  }
}
