import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
import { acquisitionOptions, response } from './acquisition-helpers.js';
import { Database } from '../src/storage/Database.js';
import { DownloadCache } from '../src/acquisition/DownloadCache.js';
import { ProviderMetadataCache } from '../src/acquisition/ProviderMetadataCache.js';
test('verified downloads are reused, corruption is redownloaded and clearing preserves permanent assets', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const a = await f.library.acquisition(
      acquisitionOptions(undefined, {
        async request() {
          calls++;
          return response();
        },
      }),
    );
    const options = {
      provider: 'polyhaven' as const,
      remoteId: 'oak',
      resolution: '2k',
      force: true,
    };
    await a.acquire(options);
    const again = await a.acquire(options);
    expect(again.downloadedBytes).toBe(0);
    expect(calls).toBe(1);
    expect((await a.cacheStats()).entries).toBe(1);
    const root = path.join(f.directory, '.cache/downloads');
    const binary = fs.readdirSync(root).find((n) => n.endsWith('.bin'))!;
    fs.writeFileSync(path.join(root, binary), 'corrupt');
    await a.acquire(options);
    expect(calls).toBe(2);
    await a.clearCache();
    expect((await a.cacheStats()).entries).toBe(0);
    expect((await f.library.validate()).ok).toBe(true);
    expect(await f.library.list()).toHaveLength(3);
  } finally {
    await f.close();
  }
});
test('cache size and age eviction are bounded, metadata survives reopen, symlinks fail closed', async () => {
  const f = await fixture();
  try {
    const a = await f.library.acquisition({
      ...acquisitionOptions(),
      downloadCache: { maxBytes: gltf.length },
    });
    await a.acquire({ provider: 'polyhaven', remoteId: 'oak', resolution: '2k' });
    await a.acquire({ provider: 'polyhaven', remoteId: 'pine', resolution: '2k' });
    expect((await a.cacheStats()).entries).toBe(1);
    const db = new Database(f.directory);
    const metadata = new ProviderMetadataCache(db);
    await metadata.set('polyhaven:test', { value: { a: 1 }, storedAt: 123, etag: 'tag' });
    expect((await new ProviderMetadataCache(db).get('polyhaven:test'))?.etag).toBe('tag');
    const cache = new DownloadCache(db, { maxAgeMs: 0 });
    const item = (await a.listPlans()).items[0].items[0];
    expect(await cache.get(item, item.files[0], f.source)).toBeUndefined();
    const key = '0'.repeat(64);
    fs.symlinkSync(f.source, path.join(cache.root, key + '.bin'));
    await expect(async () => await cache.clear()).rejects.toThrow();
    fs.unlinkSync(path.join(cache.root, key + '.bin'));
    await db.close();
  } finally {
    await f.close();
  }
});
