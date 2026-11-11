import { DownloadCache } from './DownloadCache.js';
import fs from 'node:fs';
import path from 'node:path';
import { AcquisitionStaging } from './AcquisitionStaging.js';
import { randomUUID } from 'node:crypto';
import { ModelsError, fail } from '../domain/ModelsError.js';
import type { ModelRecord } from '../domain/types.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { AcquisitionPlanRepository } from './AcquisitionPlanRepository.js';
import { AcquisitionJobRepository } from './AcquisitionJobRepository.js';
import { AcquisitionPlanner } from './AcquisitionPlanner.js';
import { DownloadManager, type DownloadedFile } from './DownloadManager.js';
import { AcquisitionImport } from './AcquisitionImport.js';
import { canonical, itemSpecification, digest } from './planSchema.js';
import type {
  ExecutionOptions,
  AcquisitionPlan,
  AcquisitionPlanItem,
  AcquisitionJob,
  AcquisitionJobItem,
  AcquisitionJobStatus,
} from './types.js';
export type ImportCommit = (
  manifest: string,
  before: () => Promise<ModelRecord | undefined>,
  after: (record: ModelRecord) => Promise<void>,
) => Promise<ModelRecord>;

/**
 * Jobs change independently of plans. Each model and its completion marker commit together.
 */
export class AcquisitionExecutor {
  private readonly runs = new Set<Promise<AcquisitionJob>>();
  private readonly active = new Map<string, { abort: AbortController; done: Promise<unknown> }>();
  private closing = false;
  constructor(
    private readonly plans: AcquisitionPlanRepository,
    private readonly jobs: AcquisitionJobRepository,
    private readonly providers: ProviderRegistry,
    private readonly planner: AcquisitionPlanner,
    private readonly downloads: DownloadManager,
    private readonly cache: DownloadCache,
    private readonly commit: ImportCommit,
    private readonly getModel: (id: string) => Promise<ModelRecord | null>,
  ) {}
  private async createJob(planId: string, options: ExecutionOptions) {
    const concurrency = options.concurrency ?? 2;
    if (
      !Number.isInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 4 ||
      (options.continueOnError !== undefined && typeof options.continueOnError !== 'boolean')
    )
      fail('INVALID_PLAN', 'Execute plan: invalid concurrency or error policy');
    if (this.closing) fail('LIBRARY_CLOSED', 'Execute plan: acquisition service closed');
    return await this.jobs.create(await this.plans.require(planId), options);
  }
  async execute(planId: string, options: ExecutionOptions = {}) {
    return await this.run((await this.createJob(planId, options)).id, options.signal);
  }
  async start(planId: string, options: ExecutionOptions = {}) {
    const job = await this.createJob(planId, options);
    void this.run(job.id, options.signal).catch(() => {

      /*
       * The job records execution failures.
       */
    });
    return await this.jobs.require(job.id);
  }
  async startResume(id: string) {
    await this.jobs.recover();
    void this.run(id).catch(() => {

      /*
       * The job remains inspectable after failures.
       */
    });
    return await this.jobs.require(id);
  }
  async resume(id: string) {
    await this.jobs.recover();
    return await this.run(id);
  }
  async cancel(id: string) {
    await this.jobs.cancel(id);
    this.active.get(id)?.abort.abort();
  }
  async close() {
    this.closing = true;
    for (const run of this.active.values()) run.abort.abort();
    await Promise.allSettled([...this.runs]);
  }
  private run(id: string, external?: AbortSignal): Promise<AcquisitionJob> {
    const work = this.runOwned(id, external);
    this.runs.add(work);
    void work.finally(() => this.runs.delete(work)).catch(() => {});
    return work;
  }
  private async runOwned(id: string, external?: AbortSignal) {
    if (this.closing) fail('LIBRARY_CLOSED', 'Execute job: acquisition service closed');
    const plan = await this.plans.require((await this.jobs.require(id)).planId);
    if (this.closing) fail('LIBRARY_CLOSED', 'Acquisition service is closing');
    await this.jobs.claim(id);
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    external?.addEventListener('abort', onAbort, { once: true });
    if (external?.aborted || this.closing) abort.abort();
    const poll = setInterval(async () => {
      try {
        await this.jobs.check(id);
      } catch {
        abort.abort();
      }
    }, 200);
    const work = this.work(id, plan, abort);
    this.active.set(id, { abort, done: work });
    return work.finally(() => {
      clearInterval(poll);
      external?.removeEventListener('abort', onAbort);
      this.active.delete(id);
    });
  }
  private async work(id: string, plan: AcquisitionPlan, abort: AbortController) {
    const queue = (await this.jobs.items(id)).filter(
      (i) => !['completed', 'skipped'].includes(i.status),
    );
    const options = await this.jobs.options(id);
    let next = 0,
      fatal = false,
      budgetExceeded = false;
    let staging: AcquisitionStaging | undefined;
    const worker = async () => {
      while (!fatal && !abort.signal.aborted) {
        const jobItem = queue[next++];
        if (!jobItem) return;
        const item = plan.items.find((i) => i.id === jobItem.planItemId)!;
        try {
          await this.item(id, plan, item, jobItem, abort.signal, staging!.root);
        } catch (cause) {
          const error =
            cause instanceof ModelsError
              ? cause
              : new ModelsError('DOWNLOAD_FAILED', 'Acquire model: operation failed', {
                  cause,
                });
          const stale = [
            'PLAN_STALE',
            'UNSUPPORTED_LICENSE',
            'DOWNLOAD_OPTION_NOT_FOUND',
            'REMOTE_MODEL_NOT_FOUND',
          ].includes(error.code);
          await this.jobs.status(
            jobItem.id,
            budgetExceeded
              ? 'failed'
              : abort.signal.aborted
                ? 'cancelled'
                : stale
                  ? 'stale'
                  : 'failed',
            { code: error.code, message: error.message },
          );
          if (error.code === 'ACQUISITION_LIMIT_EXCEEDED') {
            budgetExceeded = true;
            fatal = true;
            abort.abort();
          } else if (!options.continueOnError) fatal = true;
        }
      }
    };
    try {
      staging = new AcquisitionStaging(this.jobs.db.root, id);
      await Promise.all(Array.from({ length: options.concurrency ?? 2 }, worker));
      const current = await this.jobs.require(id);
      const status: AcquisitionJobStatus = budgetExceeded
        ? 'failed'
        : abort.signal.aborted
          ? this.closing
            ? 'interrupted'
            : 'cancelled'
          : fatal
            ? 'failed'
            : current.failedItems
              ? 'completed_with_errors'
              : 'completed';
      if (abort.signal.aborted && !budgetExceeded)
        for (const item of await this.jobs.items(id))
          if (item.status === 'pending') await this.jobs.status(item.id, 'cancelled');
      await this.jobs.finish(id, status);
      return await this.jobs.require(id);
    } catch (error) {
      abort.abort();
      await this.jobs.finish(id, 'failed');
      throw error;
    } finally {
      staging?.close();
    }
  }
  private async item(
    jobId: string,
    plan: AcquisitionPlan,
    item: AcquisitionPlanItem,
    jobItem: AcquisitionJobItem,
    signal: AbortSignal,
    stagingRoot: string,
  ) {
    const existing = await this.plans.existing(
      item.provider,
      item.remoteId,
      item.resolution,
      item.format,
    );
    if (plan.criteria.skipExisting && existing) {
      await this.jobs.db.transaction(
        async () =>
          await this.jobs.db.query(
            "UPDATE acquisition_job_items SET status='skipped',model_id=$1,completed_at=$2 WHERE id=$3",
            [existing, new Date().toISOString(), jobItem.id],
          ),
      );
      return;
    }
    await this.jobs.begin(jobId, jobItem.id);
    this.providers.get(item.provider).refresh?.();
    const current = await this.planner.resolve(
      item.provider,
      item.remoteId,
      {
        ...plan.criteria,
        resolution: item.resolution,
        resolutions: undefined,
        format: item.format,
      },
      item.ordinal,
    );
    if (canonical(itemSpecification(current)) !== canonical(itemSpecification(item)))
      fail(
        'PLAN_STALE',
        'Execute plan: provider selection or licensing changed; create a new plan',
      );
    const root = fs.mkdtempSync(path.join(stagingRoot, 'item-'));
    try {
      const files: DownloadedFile[] = [];
      for (const file of item.files) {
        signal.throwIfAborted();
        const cached = await this.cache.get(item, file, root);
        if (cached) {
          files.push(cached);
          continue;
        }
        const downloaded = await this.downloads.download(item.provider, file, root, {
          signal,
          maxBytes: file.role === 'archive' ? 512 * 1024 ** 2 : 256 * 1024 ** 2,
          onBytes: async (n) =>
            await this.jobs.transferred(jobId, jobItem.id, n, plan.criteria.maxTotalBytes),
          remainingBytes: async () =>
            plan.criteria.maxTotalBytes - (await this.jobs.require(jobId)).downloadedBytes,
        });
        await this.cache.put(item, file, downloaded);
        files.push(downloaded);
      }
      await this.jobs.status(jobItem.id, 'validating');
      const prepared = await new AcquisitionImport().prepare(
        item,
        files,
        root,
        plan.criteria.tags ?? [],
        signal,
      );
      signal.throwIfAborted();
      await this.jobs.status(jobItem.id, 'importing');
      await this.commit(
        prepared.manifestPath,
        async () => {
          await this.jobs.check(jobId);
          signal.throwIfAborted();
          const duplicate = plan.criteria.skipExisting
            ? await this.plans.existing(item.provider, item.remoteId, item.resolution, item.format)
            : undefined;
          if (duplicate) {
            await this.jobs.db.query(
              "UPDATE acquisition_job_items SET status='skipped',model_id=$1,completed_at=$2 WHERE id=$3",
              [duplicate, new Date().toISOString(), jobItem.id],
            );
            return (await this.getModel(duplicate)) ?? undefined;
          }
          return undefined;
        },
        async (record) => {
          const hashes = files.map((file, i) => ({
            filename: item.files[i].filename,
            sha256: file.sha256,
          }));
          await this.jobs.db.query(
            'INSERT INTO model_acquisitions VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
            [
              randomUUID(),
              record.id,
              jobItem.id,
              item.provider,
              item.remoteId,
              item.resolution,
              item.format,
              item.sourceUrl,
              JSON.stringify(item.expectedLicense),
              item.model.author ?? null,
              new Date().toISOString(),
              digest(itemSpecification(item)),
              JSON.stringify({
                downloads: hashes,
                files: prepared.fileHashes,
              }),
              JSON.stringify(item.model),
            ],
          );
          await this.jobs.db.query(
            "UPDATE acquisition_job_items SET status='completed',model_id=$1,completed_at=$2,warnings_json=$3 WHERE id=$4",
            [record.id, new Date().toISOString(), JSON.stringify(prepared.warnings), jobItem.id],
          );
        },
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}
