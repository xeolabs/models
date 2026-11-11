import { DownloadCache, type DownloadCacheOptions } from './DownloadCache.js';
import { ProviderMetadataCache } from './ProviderMetadataCache.js';
import { Database } from '../storage/Database.js';
import { wrap, fail } from '../domain/ModelsError.js';
import type { ModelRecord } from '../domain/types.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { ProviderHttpClient, type ProviderHttpOptions } from '../providers/ProviderHttpClient.js';
import { FederatedSearchService } from '../providers/FederatedSearchService.js';
import { AcquisitionPlanner } from './AcquisitionPlanner.js';
import { AcquisitionPlanRepository } from './AcquisitionPlanRepository.js';
import { AcquisitionJobRepository } from './AcquisitionJobRepository.js';
import { AcquisitionExecutor, type ImportCommit } from './AcquisitionExecutor.js';
import { DownloadManager } from './DownloadManager.js';
import type {
  AcquisitionCriteriaInput,
  PlanListQuery,
  ExecutionOptions,
  AcquisitionOptions,
  ModelAcquisition,
} from './types.js';
import type { ProviderId, FederatedSearchQuery } from '../providers/types.js';
export interface AcquisitionServiceOptions extends ProviderHttpOptions {
  sketchfabCredential?: import('../providers/SketchfabCredential.js').SketchfabCredentialSource;
  providers?: ProviderRegistry;
  downloadCache?: DownloadCacheOptions;
}

/**
 * Coordinates discovery, immutable plans and mutable executions over one ModelsLibrary.
 */
export class ModelAcquisitionService {
  readonly providers: ProviderRegistry;
  private readonly plans: AcquisitionPlanRepository;
  private readonly jobs: AcquisitionJobRepository;
  private readonly planner: AcquisitionPlanner;
  private readonly executor: AcquisitionExecutor;
  private closed = false;
  private initialization?: Promise<this>;
  private closing?: Promise<void>;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cache: DownloadCache;
  private readonly http: ProviderHttpClient;
  constructor(
    private readonly db: Database,
    commit: ImportCommit,
    getModel: (id: string) => Promise<ModelRecord | null>,
    private readonly assertLibraryOpen: () => Promise<void>,
    options: AcquisitionServiceOptions = {},
  ) {
    const http = new ProviderHttpClient({
      ...options,
      cache: options.cache ?? new ProviderMetadataCache(db),
    });
    this.http = http;
    this.cache = new DownloadCache(db, options.downloadCache);
    this.providers = options.providers ?? new ProviderRegistry(http, options.sketchfabCredential);
    this.plans = new AcquisitionPlanRepository(db);
    this.jobs = new AcquisitionJobRepository(db);

    this.planner = new AcquisitionPlanner(this.providers, this.plans);
    this.executor = new AcquisitionExecutor(
      this.plans,
      this.jobs,
      this.providers,
      this.planner,
      new DownloadManager(http, (provider, file, signal) => {
        const adapter = this.providers.get(provider);
        return adapter.resolveDownload
          ? adapter.resolveDownload(file, signal)
          : Promise.resolve(file.url);
      }),
      this.cache,
      commit,
      getModel,
    );
  }

  /**
   * Recover abandoned local executions before exposing persistent job state.
   */
  async initialize(): Promise<this> {
    return (this.initialization ??= this.jobs.recover().then(() => this));
  }
  private async use<T>(operation: string, work: () => T | Promise<T>): Promise<T> {
    if (this.closed || this.closing)
      fail('LIBRARY_CLOSED', operation + ': acquisition service closed');
    const task = (async () => {
      await this.assertLibraryOpen();
      if (this.closed || this.closing)
        fail('LIBRARY_CLOSED', operation + ': acquisition service closed');
      try {
        return await work();
      } catch (error) {
        throw wrap(error, operation);
      }
    })();
    this.pending.add(task);
    try {
      return await task;
    } finally {
      this.pending.delete(task);
    }
  }
  async close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.closed) return;
    this.closing = (async () => {
      await this.executor.close();
      await Promise.allSettled([...this.pending]);
      this.closed = true;
    })();
    return this.closing;
  }
  async getAcquisitions(modelId: string): Promise<ModelAcquisition[]> {
    return await this.use('Model acquisition history', async () =>
      (
        await this.db.all(
          'SELECT * FROM model_acquisitions WHERE model_id=$1 ORDER BY acquired_at,id',
          [modelId],
        )
      ).map((row) => ({
        id: row.id as string,
        modelId: row.model_id as string,
        provider: row.provider as ProviderId,
        remoteId: row.remote_asset_id as string,
        resolution: row.resolution as string,
        format: row.format as string,
        sourceUrl: row.source_url as string,
        license: JSON.parse(row.license_json as string),
        author: (row.author as string) ?? undefined,
        acquiredAt: row.acquired_at as string,
        manifestFingerprint: row.manifest_fingerprint as string,
        fileHashes: JSON.parse(row.file_hashes_json as string),
        metadata: JSON.parse(row.metadata_json as string),
      })),
    );
  }
  async cacheStats() {
    return await this.use('Cache statistics', async () => await this.cache.stats());
  }
  async clearCache() {
    return await this.use('Clear cache', async () => {
      const report = await this.cache.clear();
      this.http.clearMemory();
      return report;
    });
  }
  async search(query: FederatedSearchQuery = {}) {
    return await this.use('Remote search', () =>
      new FederatedSearchService(this.providers).search(query),
    );
  }
  async getModel(provider: ProviderId, id: string) {
    return await this.use('Remote model', () => this.providers.get(provider).getModel(id));
  }
  async getPreviewUrl(provider: ProviderId, id: string): Promise<string | undefined> {
    return await this.use('Remote model preview', async () => {
      const adapter = this.providers.get(provider);
      return adapter.getPreviewUrl
        ? adapter.getPreviewUrl(id)
        : (await adapter.getModel(id)).previewUrl;
    });
  }
  async getDownloads(provider: ProviderId, id: string) {
    return await this.use('Remote downloads', () => this.providers.get(provider).getDownloads(id));
  }
  async createPlan(criteria: AcquisitionCriteriaInput) {
    return await this.use('Create plan', async () => await this.planner.create(criteria));
  }
  async getPlan(id: string) {
    return await this.use('Get plan', async () => await this.plans.get(id));
  }
  async listPlans(query: PlanListQuery = {}) {
    return await this.use('List plans', async () => await this.plans.list(query));
  }
  async getPlanItems(id: string) {
    return await this.use('Plan items', async () => (await this.plans.require(id)).items);
  }
  async exportPlan(id: string) {
    return await this.use('Export plan', async () => await this.plans.require(id));
  }
  async importPlan(value: unknown) {
    return await this.use('Import plan', async () => await this.plans.save(value));
  }
  async executePlan(id: string, options: ExecutionOptions = {}) {
    return await this.use('Execute plan', async () => await this.executor.execute(id, options));
  }
  async startPlan(id: string, options: ExecutionOptions = {}) {
    return await this.use('Start plan', async () => await this.executor.start(id, options));
  }
  async startResumeJob(id: string) {
    return await this.use('Start resume', async () => await this.executor.startResume(id));
  }
  async getJob(id: string) {
    return await this.use('Get job', async () => await this.jobs.get(id));
  }
  async listJobs(query: PlanListQuery = {}) {
    return await this.use('List jobs', async () => await this.jobs.list(query));
  }
  async getJobItems(id: string) {
    return await this.use('Job items', async () => {
      await this.jobs.require(id);
      return await this.jobs.items(id);
    });
  }
  async resumeJob(id: string) {
    return await this.use('Resume job', async () => await this.executor.resume(id));
  }
  async cancelJob(id: string) {
    return await this.use('Cancel job', async () => await this.executor.cancel(id));
  }
  async acquire(options: AcquisitionOptions) {
    return await this.use('Acquire model', async () => {
      const plan = await this.createPlan({
        providers: [options.provider],
        assets: [{ provider: options.provider, remoteId: options.remoteId }],
        ...(options.resolutions !== undefined
          ? { resolutions: options.resolutions }
          : { resolution: options.resolution }),
        format: options.format,
        tags: options.tags,
        maxModels: 1,
        skipExisting: !options.force,
      });
      return await this.executePlan(plan.id, { signal: options.signal });
    });
  }
}
