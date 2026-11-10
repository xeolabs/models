
/**
 * Provider data describes remote files; it is deliberately separate from xeokit properties.
 */
import type { ProviderId } from './ProviderInfo.js';
export type { ProviderId, ProviderInfo } from './ProviderInfo.js';
export interface ProviderSearchQuery {
  text?: string;
  tags?: string[];
  categories?: string[];
  limit?: number;
  cursor?: string;
}
export interface ProviderLicense {
  id: string;
  name: string;
  url?: string;
  attributionRequired: boolean;
}
export interface ProviderModelStatistics {
  polygonCount?: number;
  vertexCount?: number;
  maxTextureResolution?: [number, number];
  hasLods?: boolean;
  rigged?: boolean;
}
export interface ProviderDownloadSummary {
  id: string;
  format: string;
  resolution: string;
  sizeBytes?: number;
  fileCount?: number;
}
export interface ProviderModelSummary {
  downloadOptions?: ProviderDownloadSummary[];
  statistics?: ProviderModelStatistics;
  provider: ProviderId;
  remoteId: string;
  name: string;
  description?: string;
  tags: string[];
  categories?: string[];
  sourceUrl: string;
  previewUrl?: string;
  license: ProviderLicense;
  availableResolutions?: string[];
}
export interface ProviderModel extends ProviderModelSummary {
  author?: string;
  publishedAt?: string;
  metadata?: Record<string, unknown>;
}
export interface ProviderDownloadFile {
  role: string;
  url: string;
  filename: string;
  packagePath?: string;
  sizeBytes?: number;
  checksum?: { algorithm: 'sha256' | 'sha1' | 'md5'; value: string };
}
export interface ProviderDownload {
  id: string;
  resolution: string;
  format: string;
  files: ProviderDownloadFile[];
  estimatedBytes?: number;
}
export interface ProviderSearchResult {
  items: ProviderModelSummary[];
  nextCursor?: string;
  total?: number;
}
export interface ModelProvider {
  getInfo?(): import('./ProviderInfo.js').ProviderInfo;

  /**
   * Resolve a temporary transfer URL without changing a plan's stable file identity.
   */
  resolveDownload?(file: ProviderDownloadFile, signal?: AbortSignal): Promise<string>;
  readonly id: ProviderId;
  search(query: ProviderSearchQuery): Promise<ProviderSearchResult>;
  getModel(remoteId: string): Promise<ProviderModel>;
  getDownloads(remoteId: string): Promise<ProviderDownload[]>;

  /**
   * Optional presentation data, kept separate from immutable acquisition metadata.
   */
  getPreviewUrl?(remoteId: string): Promise<string | undefined>;

  /**
   * Bypass cached metadata before executing an immutable selection.
   */
  refresh?(): void;
}
export interface FederatedSearchQuery extends Omit<ProviderSearchQuery, 'cursor'> {
  providers?: ProviderId[];
}
export interface FederatedSearchResult {
  items: ProviderModelSummary[];
  providerErrors: { provider: ProviderId; message: string }[];
}
