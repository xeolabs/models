import type { ModelPropertySet } from '../properties/types.js';
import { ServerPropertiesClient } from './ServerPropertiesClient.js';

/**
 * The small, structural part of xeokit DataModel used here. Models does not need
 * a renderer dependency; an actual SDK DataModel satisfies this interface.
 */
export interface ExternalPropertyModel {
  readonly propertySetMode: 'embedded' | 'external';
  readonly revisionId?: string | number;
  readonly destroyed: boolean;
  readonly objects: Record<
    string,
    {
      readonly propertySetIds: readonly string[];
      readonly unresolvedPropertySetIds: readonly string[];
    }
  >;
  readonly propertySets: Record<string, unknown>;
  createPropertySet(
    set: ModelPropertySet,
  ): { ok: true; value: unknown } | { ok: false; error: string };
  unloadPropertySets(
    ids: readonly string[],
  ): { ok: true; value: unknown } | { ok: false; error: string };
}

/**
 * Bridges one model to its configured server. A selection loads its missing sets;
 * older, unpinned values are released when the model's memory budget is reached.
 */
export class ExternalPropertyLoader {
  private readonly lifetime = new AbortController();
  private readonly loaded = new Map<string, number>();
  private readonly pins = new Map<string, number>();
  private bytes = 0;
  constructor(
    private readonly client: Pick<ServerPropertiesClient, 'iteratePropertySets'>,
    private readonly modelId: string,
    private readonly model: ExternalPropertyModel,
    private readonly maxBytes = 32 * 1024 ** 2,
  ) {
    if (model.propertySetMode !== 'external' || typeof model.revisionId !== 'string')
      throw new Error('External properties require a model with its source revision.');
  }
  async loadObject(objectId: string, signal?: AbortSignal): Promise<void> {
    const object = this.model.objects[objectId];
    if (!object) throw new Error('The selected data object no longer exists.');
    const combined = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    combined.throwIfAborted();
    if (this.model.destroyed) throw new Error('The data model has been destroyed.');
    const ids = [...new Set(object.propertySetIds)];
    for (const id of ids) this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
    try {
      for await (const sets of this.client.iteratePropertySets(this.modelId, {
        ids: object.unresolvedPropertySetIds,
        revision: this.model.revisionId as string,
        signal: combined,
      })) {
        combined.throwIfAborted();
        if (this.model.destroyed) throw new Error('The data model has been destroyed.');
        for (const set of sets) {
          if (this.model.propertySets[set.id]) continue;
          const bytes = new TextEncoder().encode(JSON.stringify(set)).length;
          this.evict(bytes);
          if (this.bytes + bytes > this.maxBytes)
            throw new Error(
              'This selection exceeds the property memory budget. Query its sets in smaller pages.',
            );
          const result = this.model.createPropertySet(set);
          if (result.ok === false) throw new Error(result.error);
          this.loaded.set(set.id, bytes);
          this.bytes += bytes;
        }
      }
      // Recently selected shared sets are kept longer than values from older selections.
      for (const id of ids) {
        const bytes = this.loaded.get(id);
        if (bytes !== undefined) {
          this.loaded.delete(id);
          this.loaded.set(id, bytes);
        }
      }
    } finally {
      for (const id of ids) {
        const count = this.pins.get(id)! - 1;
        if (count) this.pins.set(id, count);
        else this.pins.delete(id);
      }
    }
  }
  dispose(): void {
    this.lifetime.abort();
    if (!this.model.destroyed) this.model.unloadPropertySets([...this.loaded.keys()]);
    this.loaded.clear();
    this.bytes = 0;
  }
  private evict(required: number): void {
    for (const [id, bytes] of this.loaded) {
      if (this.bytes + required <= this.maxBytes) break;
      if (this.pins.has(id)) continue;
      const result = this.model.unloadPropertySets([id]);
      if (result.ok === false) continue;
      this.loaded.delete(id);
      this.bytes -= bytes;
    }
  }
}
