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
  private closing?: Promise<void>;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly cache: DownloadCache;
  private readonly http: ProviderHttpClient;
  constructor(
    private readonly db: Database,
    commit: ImportCommit,
    getModel: (id: string) => ModelRecord | null,
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
    this.jobs.recover();
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
    return this.use('Model acquisition history', () =>
      this.db.sql
        .prepare('SELECT * FROM model_acquisitions WHERE model_id=? ORDER BY acquired_at,id')
        .all(modelId)
        .map((row) => ({
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
    return this.use('Cache statistics', () => this.cache.stats());
  }
  async clearCache() {
    return this.use('Clear cache', () => {
      const report = this.cache.clear();
      this.http.clearMemory();
      return report;
    });
  }
  async search(query: FederatedSearchQuery = {}) {
    return this.use('Remote search', () =>
      new FederatedSearchService(this.providers).search(query),
    );
  }
  async getModel(provider: ProviderId, id: string) {
    return this.use('Remote model', () => this.providers.get(provider).getModel(id));
  }
  async getPreviewUrl(provider: ProviderId, id: string): Promise<string | undefined> {
    return this.use('Remote model preview', async () => {
      const adapter = this.providers.get(provider);
      return adapter.getPreviewUrl
        ? adapter.getPreviewUrl(id)
        : (await adapter.getModel(id)).previewUrl;
    });
  }
  async getDownloads(provider: ProviderId, id: string) {
    return this.use('Remote downloads', () => this.providers.get(provider).getDownloads(id));
  }
  async createPlan(criteria: AcquisitionCriteriaInput) {
    return this.use('Create plan', () => this.planner.create(criteria));
  }
  async getPlan(id: string) {
    return this.use('Get plan', () => this.plans.get(id));
  }
  async listPlans(query: PlanListQuery = {}) {
    return this.use('List plans', () => this.plans.list(query));
  }
  async getPlanItems(id: string) {
    return this.use('Plan items', () => this.plans.require(id).items);
  }
  async exportPlan(id: string) {
    return this.use('Export plan', () => this.plans.require(id));
  }
  async importPlan(value: unknown) {
    return this.use('Import plan', () => this.plans.save(value));
  }
  async executePlan(id: string, options: ExecutionOptions = {}) {
    return this.use('Execute plan', () => this.executor.execute(id, options));
  }
  async startPlan(id: string, options: ExecutionOptions = {}) {
    return this.use('Start plan', () => this.executor.start(id, options));
  }
  async startResumeJob(id: string) {
    return this.use('Start resume', () => this.executor.startResume(id));
  }
  async getJob(id: string) {
    return this.use('Get job', () => this.jobs.get(id));
  }
  async listJobs(query: PlanListQuery = {}) {
    return this.use('List jobs', () => this.jobs.list(query));
  }
  async getJobItems(id: string) {
    return this.use('Job items', () => {
      this.jobs.require(id);
      return this.jobs.items(id);
    });
  }
  async resumeJob(id: string) {
    return this.use('Resume job', () => this.executor.resume(id));
  }
  async cancelJob(id: string) {
    return this.use('Cancel job', () => this.executor.cancel(id));
  }
  async acquire(options: AcquisitionOptions) {
    return this.use('Acquire model', async () => {
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
      return this.executePlan(plan.id, { signal: options.signal });
    });
  }
}
