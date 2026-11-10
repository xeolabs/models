import sharp from 'sharp';
import { ModelsError, fail } from '../domain/ModelsError.js';
import { signature } from '../storage/AssetStore.js';
import { providerUrl } from '../providers/HostPolicy.js';
import { ProviderHttpClient, type ProviderHttpOptions } from '../providers/ProviderHttpClient.js';
import type { ProviderId, ProviderModelSummary } from '../providers/types.js';
interface PreviewEntry {
  url?: string;
  bytes?: Buffer;
  expires: number;
}

/**
 * Small, disposable previews live in memory, outside the model asset store.
 * URLs come from provider metadata; clients can request only a provider and model ID.
 */
export class ProviderPreviews {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private readonly controller = new AbortController();
  private readonly http: ProviderHttpClient;
  constructor(options: ProviderHttpOptions = {}) {
    this.http = new ProviderHttpClient({
      ...options,
      retries: 0,
      connectTimeoutMs: 5000,
      inactivityTimeoutMs: 10000,
      overallTimeoutMs: 15000,
    });
  }
  remember(models: ProviderModelSummary[]) {
    for (const model of models) {
      const key = model.provider + ':' + model.remoteId,
        current = this.entry(key);
      if (!current || current.url !== model.previewUrl)
        this.store(key, { url: model.previewUrl, expires: Date.now() + 3600000 });
    }
  }
  private entry(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expires > Date.now()) return entry;
    this.entries.delete(key);
    return undefined;
  }
  private store(key: string, entry: PreviewEntry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
    // Each output is at most 256 KiB, so this cache stays below 32 MiB.
    while (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
  }
  async get(
    provider: ProviderId,
    id: string,
    resolve: () => Promise<string | undefined>,
  ): Promise<Buffer> {
    if (this.controller.signal.aborted) fail('LIBRARY_CLOSED', 'Model previews: server closed');
    const key = provider + ':' + id,
      cached = this.entry(key);
    if (cached?.bytes) return cached.bytes;
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    if (this.pending.size >= 64) fail('RATE_LIMITED', 'Model previews: too many pending images');
    const task = this.load(provider, key, cached, resolve);
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }
  private async load(
    provider: ProviderId,
    key: string,
    cached: PreviewEntry | undefined,
    resolve: () => Promise<string | undefined>,
  ) {
    const url = cached?.url ?? (await resolve());
    if (!url) fail('ASSET_NOT_FOUND', 'Model preview: provider has no image');
    providerUrl(provider, url, 'preview');
    const bytes = await this.http.transfer(
      provider,
      url,
      async (response) => {
        const maximum = 8 * 1024 ** 2;
        if (Number(response.headers['content-length']) > maximum)
          fail('DOWNLOAD_TOO_LARGE', 'Model preview: image exceeds 8 MiB');
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > maximum) fail('DOWNLOAD_TOO_LARGE', 'Model preview: image exceeds 8 MiB');
          chunks.push(chunk);
        }
        const source = Buffer.concat(chunks);
        if (!['png', 'jpg', 'webp'].includes(signature(source).extension))
          fail('UNSUPPORTED_PREVIEW_FORMAT', 'Model preview: expected PNG, JPEG or WebP');
        try {
          return await sharp(source, { limitInputPixels: 16 * 1024 ** 2 })
            .rotate()
            .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();
        } catch (cause) {
          throw new ModelsError(
            'UNSUPPORTED_PREVIEW_FORMAT',
            'Model preview: invalid or oversized image',
            { cause },
          );
        }
      },
      this.controller.signal,
      { Accept: 'image/webp,image/png,image/jpeg' },
      'preview',
    );
    if (bytes.length > 256 * 1024)
      fail('DOWNLOAD_TOO_LARGE', 'Model preview: encoded thumbnail is too large');
    if (!this.controller.signal.aborted)
      this.store(key, { url, bytes, expires: Date.now() + 3600000 });
    return bytes;
  }
  async close() {
    this.controller.abort();
    await Promise.allSettled([...this.pending.values()]);
    this.entries.clear();
  }
}
