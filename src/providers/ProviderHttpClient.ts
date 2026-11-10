import { setTimeout as delay } from 'node:timers/promises';
import { ModelsError, fail } from '../domain/ModelsError.js';
import type { ProviderId } from './types.js';
import { providerUrl, type ProviderRequestPurpose } from './HostPolicy.js';
import { HttpsTransport, type HttpTransport, type HttpResponse } from './HttpsTransport.js';
import { ProviderGate } from './ProviderGate.js';
export interface MetadataCacheEntry {
  value: unknown;
  storedAt: number;
  etag?: string;
  lastModified?: string;
}
export interface MetadataCache {
  get(key: string): MetadataCacheEntry | undefined;
  set(key: string, value: MetadataCacheEntry): void;
}
export interface ProviderHttpOptions {
  userAgent?: string;
  transport?: HttpTransport;
  retries?: number;
  retryBaseMs?: number;
  pacing?: Partial<Record<ProviderId, number>>;
  connectTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  overallTimeoutMs?: number;
  cache?: MetadataCache;
}
class StatusError extends ModelsError {
  constructor(
    readonly status: number,
    readonly retryAfter: number,
  ) {
    super(
      status === 429
        ? 'RATE_LIMITED'
        : status === 404
          ? 'REMOTE_MODEL_NOT_FOUND'
          : 'PROVIDER_API_ERROR',
      `Provider request: HTTP ${status}`,
    );
  }
}
export function retryAfter(value: string | string[] | undefined): number {
  if (!value || Array.isArray(value)) return 0;
  const seconds = Number(value);
  return Math.max(
    0,
    Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now() || 0,
  );
}

/**
 * One transport policy is shared by adapters and the streaming downloader.
 */
export class ProviderHttpClient {
  private readonly transport: HttpTransport;
  private readonly gate: ProviderGate;
  private readonly memory = new Map<string, MetadataCacheEntry>();
  private fresh = false;
  constructor(private readonly options: ProviderHttpOptions = {}) {
    for (const [name, value, maximum] of [
      ['retries', options.retries, 8],
      ['retryBaseMs', options.retryBaseMs, 60000],
      ['connectTimeoutMs', options.connectTimeoutMs, 120000],
      ['inactivityTimeoutMs', options.inactivityTimeoutMs, 3600000],
      ['overallTimeoutMs', options.overallTimeoutMs, 3600000],
      ['polyhaven pacing', options.pacing?.polyhaven, 60000],
      ['sketchfab pacing', options.pacing?.sketchfab, 60000],
      ['smithsonian pacing', options.pacing?.smithsonian, 60000],
      ['buildingsmart pacing', options.pacing?.buildingsmart, 60000],
      ['community pacing', options.pacing?.['buildingsmart-community'], 60000],
    ] as const) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) ||
          value < 0 ||
          value > maximum ||
          (name.includes('Timeout') && value === 0))
      )
        fail('INVALID_PLAN', `Provider configuration: invalid ${name}`);
    }
    this.transport = options.transport ?? new HttpsTransport();
    this.gate = new ProviderGate(options.pacing);
    if (
      options.userAgent !== undefined &&
      (!options.userAgent.trim() || /[\r\n]/.test(options.userAgent))
    )
      fail('INVALID_MODEL', 'Provider configuration: User-Agent is invalid');
  }
  clearMemory() {
    this.memory.clear();
    this.fresh = false;
  }
  refresh() {
    this.fresh = true;
  }
  async transfer<T>(
    provider: ProviderId,
    value: string,
    consume: (response: HttpResponse) => Promise<T>,
    signal?: AbortSignal,
    headers: Record<string, string> = {},
    purpose: ProviderRequestPurpose = 'asset',
  ): Promise<T> {
    providerUrl(provider, value, purpose);
    const attempts = this.options.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      let release: (() => void) | undefined;
      try {
        signal?.throwIfAborted();
        release = await this.gate.enter(provider, signal);
        let url = providerUrl(provider, value, purpose);
        for (let redirects = 0; ; redirects++) {
          const response = await this.transport.request(url, {
            headers: {
              'User-Agent':
                this.options.userAgent ?? 'xeokit-models/2.0 (https://github.com/xeolabs/models)',
              'Accept-Encoding': 'identity',
              ...headers,
            },
            signal,
            connectTimeoutMs: this.options.connectTimeoutMs ?? 15000,
            inactivityTimeoutMs: this.options.inactivityTimeoutMs ?? 30000,
            overallTimeoutMs: this.options.overallTimeoutMs ?? 600000,
          });
          try {
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              if (redirects >= 3 || !response.headers.location)
                fail('INVALID_PROVIDER_RESPONSE', 'Provider request: invalid redirect chain');
              const target = providerUrl(
                provider,
                new URL(response.headers.location, url).href,
                purpose,
              );
              if (
                Object.keys(headers).some((name) => name.toLowerCase() === 'authorization') &&
                target.origin !== url.origin
              )
                fail(
                  'INVALID_PROVIDER_RESPONSE',
                  'Provider request: authenticated redirect changed origin',
                );
              url = target;
              continue;
            }
            if (
              response.status === 403 &&
              (response.headers['x-ratelimit-remaining'] === '0' || response.headers['retry-after'])
            )
              throw new ModelsError(
                'RATE_LIMITED',
                'Provider request: GitHub rate limit reached; retry after its reset window',
              );
            if (response.status !== 200 && response.status !== 304)
              throw new StatusError(response.status, retryAfter(response.headers['retry-after']));
            return await consume(response);
          } finally {
            response.close();
          }
        }
      } catch (cause) {
        if (signal?.aborted)
          throw new ModelsError('DOWNLOAD_CANCELLED', 'Provider request: cancelled', { cause });
        const retry =
          cause instanceof StatusError
            ? [429, 500, 502, 503, 504].includes(cause.status)
            : !(cause instanceof ModelsError) || cause.code === 'DOWNLOAD_TIMEOUT';
        if (!retry || attempt >= attempts) {
          if (cause instanceof ModelsError) throw cause;
          throw new ModelsError(
            'PROVIDER_UNAVAILABLE',
            'Provider request: network operation failed',
            { cause },
          );
        }
        release?.();
        release = undefined;
        const wait = Math.max(
          cause instanceof StatusError ? cause.retryAfter : 0,
          (this.options.retryBaseMs ?? 500) * 2 ** attempt * (0.75 + Math.random() * 0.5),
        );
        // Do not retry earlier than a long Retry-After. Return control to the caller instead.
        if (wait > 60000)
          throw new ModelsError(
            'RATE_LIMITED',
            'Provider request: retry later as requested by the provider',
            { cause },
          );
        await delay(wait, undefined, { signal }).catch((cause) => {
          throw new ModelsError('DOWNLOAD_CANCELLED', 'Provider request: cancelled during retry', {
            cause,
          });
        });
      } finally {
        release?.();
      }
    }
  }

  /**
   * Account details and signed download links must never enter the metadata cache.
   * The caller supplies credentials for this request only.
   */
  async authenticatedJson(
    provider: ProviderId,
    url: string,
    authorization: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!authorization || /[\r\n]/.test(authorization))
      fail('INVALID_PROVIDER_CREDENTIALS', 'Invalid provider credentials');
    try {
      return await this.transfer(
        provider,
        url,
        async (response) => {
          if (response.status !== 200)
            fail('INVALID_PROVIDER_RESPONSE', 'Provider authentication: expected JSON');
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > 1024 * 1024)
              fail('INVALID_PROVIDER_RESPONSE', 'Provider authentication: response too large');
            chunks.push(Buffer.from(chunk));
          }
          try {
            return JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            fail('INVALID_PROVIDER_RESPONSE', 'Provider authentication: invalid JSON');
          }
        },
        signal,
        { Authorization: authorization },
      );
    } catch (error) {
      if (error instanceof StatusError && error.status === 401)
        fail(
          'PROVIDER_AUTH_REQUIRED',
          'Sketchfab rejected the credentials. Reconnect your account.',
        );
      if (error instanceof StatusError && error.status === 403)
        fail(
          'PROVIDER_AUTH_FORBIDDEN',
          'Sketchfab did not allow this account to access the requested resource.',
        );
      throw error;
    }
  }
  async json(provider: ProviderId, url: string): Promise<unknown> {
    return this.metadata(provider, url, 'json', 16 * 1024 * 1024);
  }
  async text(provider: ProviderId, url: string, maximumBytes = 65536): Promise<string> {
    return (await this.metadata(provider, url, 'text', maximumBytes)) as string;
  }
  private async metadata(
    provider: ProviderId,
    url: string,
    kind: 'json' | 'text',
    maximumBytes: number,
  ): Promise<unknown> {
    const key = provider + ':' + kind + ':' + maximumBytes + ':' + url;
    const cached = this.options.cache?.get(key) ?? this.memory.get(key);
    if (!this.fresh && cached && Date.now() - cached.storedAt < 86400000)
      return structuredClone(cached.value);
    const headers: Record<string, string> = {
      Accept: kind === 'json' ? 'application/json' : 'text/plain',
    };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;
    return this.transfer(
      provider,
      url,
      async (response) => {
        let value: unknown;
        if (response.status === 304) {
          if (!cached) fail('INVALID_PROVIDER_RESPONSE', 'Provider metadata: unexpected 304');
          value = cached.value;
        } else {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maximumBytes)
              fail(
                'INVALID_PROVIDER_RESPONSE',
                'Provider metadata: response exceeds its size limit',
              );
            chunks.push(chunk);
          }
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            value = kind === 'json' ? JSON.parse(text) : text;
          } catch {
            fail('INVALID_PROVIDER_RESPONSE', 'Provider metadata: invalid JSON');
          }
        }
        const entry = {
          value,
          storedAt: Date.now(),
          etag: response.headers.etag ?? cached?.etag,
          lastModified: response.headers['last-modified'] ?? cached?.lastModified,
        };
        this.memory.set(key, entry);
        this.options.cache?.set(key, entry);
        return structuredClone(value);
      },
      undefined,
      headers,
    );
  }
}
