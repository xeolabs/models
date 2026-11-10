import fs from 'node:fs';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { DownloadManager } from '../src/acquisition/DownloadManager.js';
import { hash, response } from './acquisition-helpers.js';
const file = {
  role: 'entrypoint',
  url: 'https://dl.polyhaven.org/file/ph-assets/Models/test.gltf',
  filename: 'test.gltf',
  sizeBytes: gltf.length,
  checksum: { algorithm: 'sha256' as const, value: hash(gltf) },
};
test('streaming retries count failed transfers and leave no partial files', async () => {
  const f = await fixture();
  try {
    let calls = 0,
      bytes = 0;
    const http = new ProviderHttpClient({
      pacing: { polyhaven: 0 },
      retryBaseMs: 0,
      transport: {
        async request() {
          calls++;
          return calls === 1
            ? {
                status: 200,
                headers: {},
                body: (async function* () {
                  yield gltf.subarray(0, 10);
                  throw Error('Transient connection reset');
                })(),
                close() {},
              }
            : response();
        },
      },
    });
    const result = await new DownloadManager(http).download('polyhaven', file, f.source, {
      maxBytes: 1024,
      onBytes: (n) => (bytes += n),
      remainingBytes: () => 1024 - bytes,
    });
    expect(result.sha256).toBe(hash(gltf));
    expect(bytes).toBe(gltf.length + 10);
    expect(fs.readdirSync(f.source)).toHaveLength(1);
  } finally {
    await f.close();
  }
});
test('downloads reject oversized responses and checksum mismatches', async () => {
  const f = await fixture();
  try {
    const downloader = new DownloadManager(
      new ProviderHttpClient({
        pacing: { polyhaven: 0 },
        transport: {
          async request() {
            return response();
          },
        },
      }),
    );
    await expect(
      downloader.download('polyhaven', file, f.source, {
        maxBytes: 1,
        onBytes: () => {},
        remainingBytes: () => 999,
      }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' });
    await expect(
      downloader.download(
        'polyhaven',
        { ...file, checksum: { algorithm: 'sha256', value: '0'.repeat(64) } },
        f.source,
        { maxBytes: 1000, onBytes: () => {}, remainingBytes: () => 999 },
      ),
    ).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    expect(fs.readdirSync(f.source)).toEqual([]);
  } finally {
    await f.close();
  }
});
