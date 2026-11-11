import { Database } from '../storage/Database.js';
import type { MetadataCache, MetadataCacheEntry } from '../providers/ProviderHttpClient.js';

/**
 * Provider responses are disposable cache records, separate from immutable plans.
 */
export class ProviderMetadataCache implements MetadataCache {
  constructor(private readonly db: Database) {}
  async get(key: string): Promise<MetadataCacheEntry | undefined> {
    const row = await this.db.one('SELECT * FROM provider_cache WHERE key=$1', [key]);
    return row
      ? {
          value: JSON.parse(row.value_json as string),
          storedAt: Number(row.stored_at),
          etag: (row.etag as string) ?? undefined,
          lastModified: (row.last_modified as string) ?? undefined,
        }
      : undefined;
  }
  async set(key: string, value: MetadataCacheEntry) {
    await this.db.transaction(
      async () =>
        await this.db.query(
          'INSERT INTO provider_cache VALUES($1,$2,$3,$4,$5) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,stored_at=excluded.stored_at,etag=excluded.etag,last_modified=excluded.last_modified',
          [
            key,
            JSON.stringify(value.value),
            value.storedAt,
            value.etag ?? null,
            value.lastModified ?? null,
          ],
        ),
    );
  }
}
