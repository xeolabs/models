import type { ModelPropertySet } from '../properties/types.js';

/**
 * Keeps recently requested values within a byte budget. Stored values are private
 * copies, so callers cannot accidentally change another consumer's cached result.
 */
export class PropertyValueCache {
  private readonly entries = new Map<string, { value: ModelPropertySet; bytes: number }>();
  private bytes = 0;
  constructor(private readonly maxBytes = 16 * 1024 ** 2) {}
  get(key: string): ModelPropertySet | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }
  set(key: string, value: ModelPropertySet): void {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    if (bytes > this.maxBytes) return;
    this.remove(key);
    while (this.bytes + bytes > this.maxBytes && this.entries.size)
      this.remove(this.entries.keys().next().value!);
    this.entries.set(key, { value: structuredClone(value), bytes });
    this.bytes += bytes;
  }
  clear(prefix = ''): void {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.remove(key);
  }
  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
}
