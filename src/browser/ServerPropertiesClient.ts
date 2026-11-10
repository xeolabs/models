import { readPropertyResponse } from './readPropertyResponse.js';
import { propertyInput, propertySetPageSchema } from '../properties/schema.js';
import { ModelsError } from '../domain/ModelsError.js';
import type {
  ModelPropertiesInfo,
  ModelPropertySet,
  PropertySetPage,
  ObjectPropertiesQuery,
  ObjectPropertiesPage,
  PropertyObjectQuery,
  PropertyObjectPage,
} from '../properties/types.js';
import { PropertyValueCache } from './PropertyValueCache.js';

interface Waiter {
  resolve(value: ModelPropertySet): void;
  reject(error: unknown): void;
  removeAbort(): void;
}
interface PendingSet {
  key: string;
  modelId: string;
  revision: string;
  id: string;
  waiters: Set<Waiter>;
  batch?: { controller: AbortController; entries: PendingSet[] };
}

/**
 * Fetches only missing values. Calls made in the same turn are batched, shared
 * sets have one pending request, and cancelling one caller does not cancel others.
 */
export class ServerPropertiesClient {
  private readonly cache: PropertyValueCache;
  private readonly pending = new Map<string, PendingSet>();
  private active = 0;
  private scheduled = false;
  constructor(
    private readonly baseUrl: string,
    options: { cacheBytes?: number } = {},
  ) {
    this.cache = new PropertyValueCache(options.cacheBytes);
  }
  async info(modelId: string, signal?: AbortSignal): Promise<ModelPropertiesInfo> {
    return this.request(modelId, 'properties', undefined, signal);
  }
  async getPropertySets(
    modelId: string,
    options: { ids: readonly string[]; revision: string; signal?: AbortSignal },
  ): Promise<ModelPropertySet[]> {
    if (options.signal?.aborted)
      throw options.signal.reason ?? new DOMException('Cancelled', 'AbortError');
    const unique = [...new Set(options.ids)];
    // Limit a single caller's pending promises; larger work uses iteratePropertySets.
    if (unique.length > 4096)
      throw new ModelsError(
        'INVALID_PROPERTY_QUERY',
        'Properties: request at most 4096 sets or use the iterator',
      );
    return Promise.all(unique.map((id) => this.get(modelId, options.revision, id, options.signal)));
  }
  async *iteratePropertySets(
    modelId: string,
    options: { ids: readonly string[]; revision: string; signal?: AbortSignal },
  ): AsyncGenerator<ModelPropertySet[]> {
    const ids = [...new Set(options.ids)];
    for (let start = 0; start < ids.length; start += 128) {
      const batch = ids.slice(start, start + 128);
      const cached: ModelPropertySet[] = [],
        missing: string[] = [];
      for (const id of batch) {
        const value = this.cache.get(this.key(modelId, options.revision, id));
        if (value) cached.push(value);
        else missing.push(id);
      }
      if (cached.length) yield cached;
      let cursor: number | undefined;
      const expected = new Set(missing);
      while (missing.length) {
        options.signal?.throwIfAborted();
        const page: PropertySetPage = await this.request(
          modelId,
          'property-sets/query',
          {
            ids: missing,
            revision: options.revision,
            cursor,
          },
          options.signal,
        );
        if (
          page.revision !== options.revision ||
          (page.nextCursor !== undefined && page.nextCursor <= (cursor ?? 0))
        )
          throw new ModelsError(
            'PROPERTY_REVISION_MISMATCH',
            'Properties: inconsistent server response',
          );
        if (page.missingIds.length)
          throw new ModelsError(
            'PROPERTY_SET_NOT_FOUND',
            'Properties: some referenced sets do not exist',
          );
        for (const set of page.propertySets) {
          if (!expected.delete(set.id))
            throw new ModelsError(
              'INVALID_PROPERTY_QUERY',
              'Properties: unexpected or repeated set',
            );
          this.cache.set(this.key(modelId, options.revision, set.id), set);
        }
        yield page.propertySets;
        cursor = page.nextCursor;
        if (cursor === undefined) {
          if (expected.size)
            throw new ModelsError(
              'INVALID_PROPERTY_QUERY',
              'Properties: incomplete server response',
            );
          break;
        }
      }
    }
  }

  async getObjectProperties(
    modelId: string,
    query: ObjectPropertiesQuery,
    signal?: AbortSignal,
  ): Promise<ObjectPropertiesPage> {
    return this.request(modelId, 'object-properties/query', query, signal);
  }
  async queryPropertyObjects(
    modelId: string,
    query: PropertyObjectQuery,
    signal?: AbortSignal,
  ): Promise<PropertyObjectPage> {
    return this.request(modelId, 'property-objects/query', query, signal);
  }
  clear(modelId?: string): void {
    const prefix = modelId === undefined ? '' : JSON.stringify(modelId) + ':';
    this.cache.clear(prefix);
    for (const entry of [...this.pending.values()]) {
      if (prefix && !entry.key.startsWith(prefix)) continue;
      this.finish(entry, undefined, new DOMException('Properties released', 'AbortError'));
      this.abortIfUnused(entry);
    }
  }
  private key(modelId: string, revision: string, id: string): string {
    return JSON.stringify(modelId) + ':' + JSON.stringify([revision, id]);
  }
  private get(
    modelId: string,
    revision: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<ModelPropertySet> {
    const key = this.key(modelId, revision, id);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { key, modelId, revision, id, waiters: new Set() };
      this.pending.set(key, entry);
    }
    const selected = entry;
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        removeAbort: () => signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        selected.waiters.delete(waiter);
        waiter.removeAbort();
        reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
        if (!selected.waiters.size && this.pending.get(key) === selected) this.pending.delete(key);
        this.abortIfUnused(selected);
      };
      selected.waiters.add(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      this.schedule();
    });
  }
  private abortIfUnused(entry: PendingSet): void {
    if (entry.batch?.entries.every((item) => !item.waiters.size)) entry.batch.controller.abort();
  }
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      while (this.active < 2) {
        const first = [...this.pending.values()].find(
          (entry) => !entry.batch && entry.waiters.size,
        );
        if (!first) break;
        const entries = [...this.pending.values()]
          .filter(
            (entry) =>
              !entry.batch &&
              entry.waiters.size &&
              entry.modelId === first.modelId &&
              entry.revision === first.revision,
          )
          .slice(0, 128);
        const batch = { controller: new AbortController(), entries };
        for (const entry of entries) entry.batch = batch;
        this.active++;
        void this.load(batch).finally(() => {
          this.active--;
          this.schedule();
        });
      }
    });
  }
  private async load(batch: { controller: AbortController; entries: PendingSet[] }): Promise<void> {
    const first = batch.entries[0];
    let cursor: number | undefined;
    const remaining = new Map(batch.entries.map((entry) => [entry.id, entry]));
    try {
      do {
        const page: PropertySetPage = await this.request(
          first.modelId,
          'property-sets/query',
          {
            ids: batch.entries.map((entry) => entry.id),
            revision: first.revision,
            cursor,
          },
          batch.controller.signal,
        );
        if (
          page.revision !== first.revision ||
          (page.nextCursor !== undefined && page.nextCursor <= (cursor ?? 0))
        )
          throw new ModelsError(
            'PROPERTY_REVISION_MISMATCH',
            'Properties: inconsistent server response',
          );
        for (const set of page.propertySets) {
          const entry = remaining.get(set.id);
          if (!entry)
            throw new ModelsError(
              'INVALID_PROPERTY_QUERY',
              'Properties: unexpected set in response',
            );
          if (entry.waiters.size) this.cache.set(entry.key, set);
          this.finish(entry, set);
          remaining.delete(set.id);
        }
        for (const id of page.missingIds) {
          const entry = remaining.get(id);
          if (entry)
            this.finish(
              entry,
              undefined,
              new ModelsError('PROPERTY_SET_NOT_FOUND', 'Properties: set does not exist: ' + id),
            );
          remaining.delete(id);
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      if (remaining.size)
        throw new ModelsError('INVALID_PROPERTY_QUERY', 'Properties: incomplete server response');
    } catch (error) {
      for (const entry of remaining.values()) this.finish(entry, undefined, error);
    }
  }
  private finish(entry: PendingSet, value?: ModelPropertySet, error?: unknown): void {
    if (this.pending.get(entry.key) === entry) this.pending.delete(entry.key);
    for (const waiter of entry.waiters) {
      waiter.removeAbort();
      if (value) waiter.resolve(structuredClone(value));
      else waiter.reject(error);
    }
    entry.waiters.clear();
  }
  private async request<T>(
    modelId: string,
    route: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(
      this.baseUrl + '/api/models/' + encodeURIComponent(modelId) + '/' + route,
      {
        method: body === undefined ? 'GET' : 'POST',
        signal,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      },
    );
    const data = await readPropertyResponse(response);
    return (
      route === 'property-sets/query' ? propertyInput(propertySetPageSchema, data) : data
    ) as T;
  }
}
