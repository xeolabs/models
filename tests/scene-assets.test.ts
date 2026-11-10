import { test, expect, vi, afterEach } from 'vitest';
import { ServerModelAssets } from '../src/browser/ServerModelAssets.js';
import { sceneAssetHash } from '../src/browser/readSceneAssetBytes.js';
import type { ServerModelsClient } from '../src/browser/ServerModelsClient.js';
const modelId = '09ae2b5a-ec51-40c8-b9b7-23ee5fcd0eba';
afterEach(() => vi.unstubAllGlobals());

test('geometry references discover one package and download a shared shard only once', async () => {
  const shard = new Uint8Array([2, 0, 0, 0, 1, 2, 3, 4]);
  const hash = await sceneAssetHash(shard);
  const index = new TextEncoder().encode(
    JSON.stringify({
      format: 'XGFStreamingIndex',
      indexVersion: '1.2.0',
      chunks: [{ role: 'assetLibrary', uri: 'assets.xgf', assets: { geometries: ['one', 'two'] } }],
    }),
  );
  const representation = {
    modelId,
    format: 'xgfstream',
    entrypoint: 'index.runtime.json',
    files: [
      { path: 'index.json', bytes: index.length, sha256: await sceneAssetHash(index) },
      { path: 'assets.xgf', bytes: shard.length, sha256: hash },
    ],
  };
  const getFormat = vi.fn(async () => representation);
  const client = {
    getFormat,
    formatFileUrl: (_id: string, _format: string, name: string) =>
      'https://configured.example/' + name,
  } as unknown as ServerModelsClient;
  const api = new ServerModelAssets(client, 'library');
  const fetcher = vi.fn(
    async (url: string) => new Response(url.endsWith('index.json') ? index : shard),
  );
  vi.stubGlobal('fetch', fetcher);
  const refs = await api.references(modelId);
  expect(refs).toHaveLength(2);
  expect(refs[0].revision).toBe(hash);
  expect(getFormat).toHaveBeenCalledTimes(1);
  const files = await api.resolve(refs);
  expect(files).toHaveLength(1);
  expect(files[0].geometryIds).toEqual(['one', 'two']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(api.resolve([{ ...refs[0], variant: '../secret' }])).rejects.toThrow('package');
  await expect(api.resolve([{ ...refs[0], namespace: 'unconfigured' }])).rejects.toThrow('library');
  await expect(api.resolve(refs, { maxBytes: 1 })).rejects.toThrow('byte limit');
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([0])));
  await expect(api.resolve(refs)).rejects.toThrow('hash');
});

test('discovery bounds are checked before loading binary geometry', async () => {
  const api = new ServerModelAssets(
    { getFormat: vi.fn() } as unknown as ServerModelsClient,
    'library',
  );
  await expect(api.references(modelId, { maxReferences: 0 })).rejects.toThrow('limit');
  await expect(api.resolve([])).resolves.toEqual([]);
});
