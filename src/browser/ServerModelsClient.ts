import { ServerPropertiesClient } from './ServerPropertiesClient.js';
import type {
  PropertySetMode,
  ObjectPropertiesQuery,
  PropertyObjectQuery,
} from '../properties/types.js';
import type { ConversionFormat, ModelDownloadFormats } from '../conversion/types.js';
import { encodeModelFilePath, modelHotloadUrl } from './modelFileUrls.js';
import type {
  AvailableModelFormats,
  ModelFormatRepresentation,
  ModelRepresentationFormat,
} from '../conversion/ModelFormats.js';
import type { ModelPickerCapabilities } from './ModelPickerProtocol.js';
import type { ModelRecord, ModelQuery } from '../domain/types.js';

/**
 * Browser clients discover formats and receive original or converted model files.
 * A renderer can load the entry URL and resolve its glTF dependencies normally.
 */
export class ServerModelsClient {
  readonly properties: ServerPropertiesClient;
  private constructor(readonly baseUrl: string) {
    this.properties = new ServerPropertiesClient(baseUrl);
  }
  dataModelUrl(
    modelId: string,
    options: { propertySetMode?: PropertySetMode; download?: boolean } = {},
  ): string {
    const query = new URLSearchParams();
    if (options.propertySetMode) query.set('properties', options.propertySetMode);
    if (options.download) query.set('download', '1');
    return this.baseUrl + '/api/models/' + encodeURIComponent(modelId) + '/datamodel?' + query;
  }
  async propertiesInfo(modelId: string, signal?: AbortSignal) {
    return this.properties.info(modelId, signal);
  }
  async getPropertySets(
    modelId: string,
    options: { ids: readonly string[]; revision: string; signal?: AbortSignal },
  ) {
    return this.properties.getPropertySets(modelId, options);
  }
  async getObjectProperties(modelId: string, query: ObjectPropertiesQuery, signal?: AbortSignal) {
    return this.properties.getObjectProperties(modelId, query, signal);
  }
  async queryPropertyObjects(modelId: string, query: PropertyObjectQuery, signal?: AbortSignal) {
    return this.properties.queryPropertyObjects(modelId, query, signal);
  }
  async configureProperties(modelId: string, options: { mode: PropertySetMode }) {
    const response = await fetch(
      this.baseUrl + '/api/models/' + encodeURIComponent(modelId) + '/properties',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Models-Action': 'explicit' },
        body: JSON.stringify(options),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Error(result.error?.message ?? 'Could not change property storage');
    this.properties.clear(modelId);
    return result.data as {
      properties: import('../properties/types.js').ModelPropertiesInfo;
      job: import('../processing/types.js').ProcessingJob;
    };
  }
  static async open(baseUrl: string, signal?: AbortSignal) {
    const url = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'Models server URL must use HTTP or HTTPS without credentials, a query or a fragment.',
      );
    const client = new ServerModelsClient(baseUrl.replace(/\/$/, ''));
    await client.getJson('/api/summary', signal);
    return client;
  }
  async thumbnailStatus(modelId: string, signal?: AbortSignal) {
    const result = await this.getJson<{ ready: boolean; url?: string }>(
      '/api/models/' + encodeURIComponent(modelId) + '/thumbnail/status',
      signal,
    );
    return { ...result, ...(result.url ? { url: this.baseUrl + result.url } : {}) };
  }
  async processing(modelId?: string, signal?: AbortSignal) {
    return this.getJson<import('../processing/types.js').ProcessingOverview>(
      '/api/processing' + (modelId ? '?modelId=' + encodeURIComponent(modelId) : ''),
      signal,
    );
  }
  private async processingAction<T>(route: string, method = 'POST', body?: unknown): Promise<T> {
    const response = await fetch(this.baseUrl + '/api/processing/' + route, {
      method,
      headers: { 'X-Models-Action': 'explicit', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Error(result.error?.message ?? 'Processing action failed');
    return result.data;
  }
  async configureProcessing(patch: Partial<import('../processing/types.js').ProcessingSettings>) {
    return this.processingAction<import('../processing/types.js').ProcessingSettings>(
      'settings',
      'PATCH',
      patch,
    );
  }
  async prepareIFC(modelId: string) {
    return this.processingAction<import('../processing/types.js').ProcessingJob>(
      'models/' + encodeURIComponent(modelId) + '/prepare',
    );
  }
  async cancelConversion(jobId: string) {
    await this.processingAction('jobs/' + encodeURIComponent(jobId) + '/cancel');
  }
  async retryConversion(jobId: string) {
    return this.processingAction<import('../processing/types.js').ProcessingJob>(
      'jobs/' + encodeURIComponent(jobId) + '/retry',
    );
  }
  private async getJson<T>(route: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(this.baseUrl + route, { signal });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw Error(result.error?.message ?? 'Models server request failed');
    return result.data;
  }
  async pickerCapabilities(signal?: AbortSignal) {
    return this.getJson<ModelPickerCapabilities>('/api/picker', signal);
  }
  async search(query: ModelQuery = {}, signal?: AbortSignal) {
    const params = new URLSearchParams();
    if (query.text) params.set('q', query.text);
    if (query.format) params.set('format', query.format);
    for (const format of query.formats ?? []) params.append('formats', format);
    if (query.provider) params.set('provider', query.provider);
    for (const tag of query.tags ?? []) params.append('tag', tag);
    params.set('limit', String(query.limit ?? 50));
    params.set('offset', String(query.offset ?? 0));
    return this.getJson<{ items: ModelRecord[]; total: number }>('/api/models?' + params, signal);
  }
  async get(id: string, signal?: AbortSignal) {
    return this.getJson<ModelRecord>('/api/models/' + encodeURIComponent(id), signal);
  }
  fileUrl(id: string, name: string) {
    return (
      this.baseUrl + '/api/models/' + encodeURIComponent(id) + '/files/' + encodeModelFilePath(name)
    );
  }
  async entryUrl(
    id: string,
    options: { format?: ModelRepresentationFormat; signal?: AbortSignal } = {},
  ) {
    if (options.format) {
      const representation = await this.getFormat(id, options.format, options.signal);
      return this.formatFileUrl(id, options.format, representation.entrypoint);
    }
    const model = await this.get(id, options.signal);
    if (!model.entrypoint) throw Error('Model has no entrypoint');
    return this.fileUrl(id, model.entrypoint);
  }

  /**
   * Discover formats. IFC preparation also caches reusable XGF and DataModel files.
   */
  async availableFormats(id: string, signal?: AbortSignal): Promise<AvailableModelFormats> {
    return this.getJson('/api/models/' + encodeURIComponent(id) + '/formats', signal);
  }

  /**
   * Prepare one format and describe its files, including semantic companions.
   */
  async getFormat(
    id: string,
    format: ModelRepresentationFormat,
    signal?: AbortSignal,
  ): Promise<ModelFormatRepresentation> {
    return this.getJson(
      '/api/models/' + encodeURIComponent(id) + '/formats/' + encodeURIComponent(format),
      signal,
    );
  }
  formatFileUrl(id: string, format: ModelRepresentationFormat, name: string): string {
    // Reuse the original-file path validation before constructing a format URL.
    this.fileUrl(id, name);
    return (
      this.baseUrl +
      '/api/models/' +
      encodeURIComponent(id) +
      '/formats/' +
      encodeURIComponent(format) +
      '/files/' +
      encodeModelFilePath(name)
    );
  }

  /**
   * Build a public, read-only file URL without generating a conversion. Use the
   * entrypoint from availableFormats, or a file path from a prepared representation.
   */
  hotloadUrl(id: string, format: ModelRepresentationFormat, entrypoint: string): string {
    return modelHotloadUrl(this.baseUrl, id, format, entrypoint);
  }
  async downloadFormats(id: string, signal?: AbortSignal) {
    return this.getJson<ModelDownloadFormats>(
      '/api/models/' + encodeURIComponent(id) + '/download-formats',
      signal,
    );
  }

  /**
   * The first download generates this format. Later requests reuse its verified cache.
   */
  conversionDownloadUrl(id: string, format: ConversionFormat) {
    return (
      this.baseUrl +
      '/api/models/' +
      encodeURIComponent(id) +
      '/conversions/' +
      encodeURIComponent(format) +
      '/download'
    );
  }
  bundleUrl(id: string) {
    return this.baseUrl + '/api/models/' + encodeURIComponent(id) + '/bundle';
  }
}
