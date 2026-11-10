import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { acquisitionOptions } from './acquisition-helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';

test('conversion routes generate on demand, cache downloads, and delete with the model', async () => {
  const f = await fixture();
  const input = path.join(f.source, 'triangle.obj');
  fs.writeFileSync(input, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const model = (await f.library.importFile({ path: input })).model!;
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    allowedOrigins: ['http://viewer.example'],
    acquisition: acquisitionOptions(),
  });
  try {
    const client = await ServerModelsClient.open(server.url);
    expect(
      (await client.downloadFormats(model.id)).formats.find((item) => item.format === 'glb')
        ?.cached,
    ).toBe(false);
    const discovery = await client.availableFormats(model.id);
    expect(discovery.formats.find((item) => item.format === 'obj')).toMatchObject({
      source: 'original',
      cached: true,
    });
    expect(discovery.formats.find((item) => item.format === 'xgf')).toMatchObject({
      source: 'converted',
      cached: false,
    });
    expect(await client.entryUrl(model.id)).toBe(client.fileUrl(model.id, 'triangle.obj'));
    const original = await client.getFormat(model.id, 'obj');
    expect(original.source).toBe('original');
    const xgf = await client.getFormat(model.id, 'xgf');
    expect(xgf).toMatchObject({ format: 'xgf', source: 'converted', cached: false });
    const entry = await client.entryUrl(model.id, { format: 'xgf' });
    expect(entry).toBe(client.formatFileUrl(model.id, 'xgf', xgf.entrypoint));
    const inline = await fetch(entry, { headers: { Origin: 'http://viewer.example' } });
    expect(inline.status).toBe(200);
    expect(inline.headers.get('content-disposition')).toBeNull();
    expect(inline.headers.get('access-control-allow-origin')).toBe('http://viewer.example');
    const xgfBytes = Buffer.from(await inline.arrayBuffer());
    expect(xgfBytes.readUInt32LE(0)).toBe(3);
    expect(
      JSON.parse(xgfBytes.subarray(24, 24 + xgfBytes.readUInt32LE(4)).toString()).coordinateSystem
        .basis,
    ).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const partial = await fetch(entry, { headers: { Range: 'bytes=0-3' } });
    expect(partial.status).toBe(206);
    expect(Buffer.from(await partial.arrayBuffer()).readUInt32LE(0)).toBe(3);
    const local = await f.library.resolveFormatFile(model.id, 'xgf', xgf.entrypoint);
    expect(fs.readFileSync(local.path)).toEqual(xgfBytes);
    expect(
      (await f.library.availableFormats(model.id)).formats.find((item) => item.format === 'xgf')
        ?.cached,
    ).toBe(true);
    await expect(
      f.library.resolveFormatFile(model.id, 'xgf', '../manifest.json'),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    expect(() => client.formatFileUrl(model.id, 'xgf', '../outside')).toThrow(/inside/);
    expect((await fetch(client.formatFileUrl(model.id, 'xgf', 'manifest.json'))).status).toBe(404);
    expect((await fetch(entry, { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
    const url = client.conversionDownloadUrl(model.id, 'glb');
    const result = await fetch(url, { headers: { Origin: 'http://viewer.example' } });
    expect(result.status).toBe(200);
    expect(result.headers.get('content-disposition')).toContain('model.glb');
    expect(result.headers.get('content-type')).toBe('model/gltf-binary');
    expect(result.headers.get('access-control-allow-origin')).toBe('http://viewer.example');
    expect(
      Buffer.from(await result.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('glTF');
    expect(
      (await client.downloadFormats(model.id)).formats.find((item) => item.format === 'glb')
        ?.cached,
    ).toBe(true);
    const references = await client.sceneAssets.references(model.id);
    expect(references.length).toBeGreaterThan(0);
    const shards = await client.sceneAssets.resolve(references);
    expect(shards.flatMap((shard) => shard.geometryIds)).toHaveLength(references.length);
    expect(shards.every((shard) => shard.bytes.byteLength > 4)).toBe(true);
    const headers = { 'X-Models-Action': 'explicit' };
    const endpoint = server.url + '/api/models/' + model.id;
    expect((await fetch(endpoint + '/conversions/glb', { method: 'POST' })).status).toBe(409);
    expect(
      (await (await fetch(endpoint + '/conversions/glb', { method: 'POST', headers })).json()).data
        .cached,
    ).toBe(true);
    expect((await fetch(url, { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(endpoint, { method: 'DELETE', headers })).status).toBe(200);
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions', model.id))).toBe(false);
    expect((await fetch(url)).status).toBe(404);
    expect((await fetch(entry)).status).toBe(404);
    await expect(client.sceneAssets.resolve(references)).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
  } finally {
    await server.close();
    await f.close();
  }
}, 30000);
