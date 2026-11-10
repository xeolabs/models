import type {
  ProviderId,
  ProviderDownloadFile,
  ProviderLicense,
  ProviderModel,
} from '../providers/types.js';
export interface AcquisitionWarning {
  code: string;
  message: string;
}
export interface AcquisitionCriteria {
  providers: ProviderId[];
  query?: string;
  tags?: string[];
  categories?: string[];
  selections?: { query: string; maxModels: number }[];

  /**
   * Explicit remote identities support on-demand import without a second pipeline.
   */
  assets?: { provider: ProviderId; remoteId: string }[];
  resolution?: string;

  /**
   * Choose several provider sizes, or every available size. Use this instead of resolution.
   */
  resolutions?: string[] | 'all';
  format?: string;

  /**
   * Limit distinct provider models; each selected resolution becomes its own plan item.
   */
  maxModels: number;
  maxPackageBytes?: number;
  maxPolygons?: number;
  maxTotalBytes: number;
  skipExisting: boolean;

  /**
   * Unknown sizes require an explicit policy; every transfer still has a hard byte cap.
   */
  allowUnknownSizes: boolean;
  unknownSizeReservationBytes: number;
}
export type ResolutionSelection =
  | { resolution: string; resolutions?: never }
  | { resolution?: never; resolutions: string[] | 'all' };
export type AcquisitionCriteriaInput = Partial<AcquisitionCriteria> & ResolutionSelection;
export interface AcquisitionPlanItem {
  id: string;
  ordinal: number;
  provider: ProviderId;
  remoteId: string;
  modelName: string;
  sourceUrl: string;
  resolution: string;
  format: string;
  downloadId: string;
  files: ProviderDownloadFile[];
  expectedLicense: ProviderLicense;
  existingModelId?: string;
  warnings: AcquisitionWarning[];
  model: ProviderModel;
}
export interface AcquisitionPlanSummary {
  selectedModels: number;
  knownBytes: number;
  unknownSizeFiles: number;
  estimatedTotalBytes?: number;
}
export interface AcquisitionPlan {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  expiresAt?: string;
  criteria: AcquisitionCriteria;
  items: AcquisitionPlanItem[];
  summary: AcquisitionPlanSummary;
  fingerprint: string;
  warnings: AcquisitionWarning[];
}
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface PlanListQuery {
  limit?: number;
  offset?: number;
}
export type AcquisitionJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type AcquisitionJobItemStatus =
  | 'pending'
  | 'downloading'
  | 'validating'
  | 'importing'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'stale'
  | 'cancelled';
export interface AcquisitionJob {
  id: string;
  planId: string;
  status: AcquisitionJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  downloadedBytes: number;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
}
export interface AcquisitionJobItem {
  id: string;
  jobId: string;
  planItemId: string;
  modelName: string;
  provider: ProviderId;
  remoteId: string;
  resolution: string;
  format: string;
  status: AcquisitionJobItemStatus;
  attempts: number;
  downloadedBytes: number;
  modelId?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  warnings: AcquisitionWarning[];
}
export interface ExecutionOptions {
  concurrency?: number;
  continueOnError?: boolean;
  signal?: AbortSignal;
}
export type AcquisitionOptions = ResolutionSelection & {
  provider: ProviderId;
  remoteId: string;
  format?: string;
  tags?: string[];
  force?: boolean;
  signal?: AbortSignal;
};

export interface ModelAcquisition {
  id: string;
  modelId: string;
  provider: ProviderId;
  remoteId: string;
  resolution: string;
  format: string;
  sourceUrl: string;
  license: ProviderLicense;
  author?: string;
  acquiredAt: string;
  manifestFingerprint: string;
  fileHashes: {
    downloads: { filename: string; sha256: string }[];
    files: { filename: string; sha256: string }[];
  };
  metadata: ProviderModel;
}
