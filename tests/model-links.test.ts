import fs from 'node:fs';
import path from 'node:path';
import { get as httpGet } from 'node:http';
import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.js';
import { acquisitionOptions } from './acquisition-helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';
import { ConversionRunner } from '../src/conversion/ConversionRunner.js';

const headers = { Origin: 'https://any-viewer.example', 'Sec-Fetch-Site': 'cross-site' };

test('shared original URLs preserve nested paths and allow read-only cross-origin loads', async () => {
  const f = await fixture();
  fs.mkdirSync(path.join(f.source, 'scenes'));
  fs.mkdirSync(path.join(f.source, 'scenes/data'));
  const data = Buffer.from([1, 2, 3, 4]);
  fs.writeFileSync(path.join(f.source, 'scenes/data/mesh.bin'), data);
  fs.writeFileSync(
    path.join(f.source, 'scenes/My model.gltf'),
    JSON.stringify({
      asset: { version: '2.0' },
      scenes: [{ nodes: [] }],
      scene: 0,
      buffers: [{ uri: 'data/mesh.bin', byteLength: data.length }],
    }),
  );
  const manifestPath = path.join(f.source, 'model.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      metadata: { name: 'Nested model' },
      entrypoint: 'scenes/My model.gltf',
      files: [{ path: 'scenes/My model.gltf' }, { path: 'scenes/data/mesh.bin' }],
    }),
  );
  const model = (await f.library.importManifest({ manifestPath })).model!;
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    acquisition: acquisitionOptions(),
  });
  try {
    const client = await ServerModelsClient.open(server.url);
    const entry = client.hotloadUrl(model.id, 'gltf', model.entrypoint!);
    expect(entry).toContain('/gltf/files/scenes/My%20model.gltf');
    const response = await fetch(entry, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('content-disposition')).toBeNull();
    const document = await response.json();
    const dependency = new URL(document.buffers[0].uri, entry);
    expect(Buffer.from(await (await fetch(dependency, { headers })).arrayBuffer())).toEqual(data);
    const head = await fetch(dependency, { method: 'HEAD', headers });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('4');
    expect(await head.text()).toBe('');
    const range = await fetch(dependency, { headers: { ...headers, Range: 'bytes=1-2' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('access-control-expose-headers')).toContain('Content-Range');
    expect(Buffer.from(await range.arrayBuffer())).toEqual(data.subarray(1, 3));
    const preflight = await fetch(dependency, {
      method: 'OPTIONS',
      headers: {
        ...headers,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Range',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toBe('Range');
    for (const route of [
      '/api/models',
      '/api/summary',
      '/api/acquisition/jobs',
      '/api/models/' + model.id + '/formats',
    ])
      expect((await fetch(server.url + route, { headers })).status, route).toBe(403);
    expect(
      (
        await fetch(entry, {
          method: 'DELETE',
          headers: { ...headers, 'X-Models-Action': 'explicit' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(entry, {
          method: 'OPTIONS',
          headers: { ...headers, 'Access-Control-Request-Method': 'POST' },
        })
      ).status,
    ).toBe(403);
    // Node fetch replaces Host, so use the HTTP client to send the actual hostile header.
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      httpGet(entry, { headers: { ...headers, Host: 'untrusted.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    expect(badHost).toBe(403);
    expect(
      (await fetch(entry.replace('scenes/My%20model.gltf', '%2e%2e%2fmaterials.db'), { headers }))
        .status,
    ).toBe(400);
    expect(
      (await fetch(entry.replace('scenes/My%20model.gltf', 'missing.bin'), { headers })).status,
    ).toBe(404);
    expect(() => client.hotloadUrl(model.id, 'gltf', '../private')).toThrow(/inside/);
    await f.library.delete(model.id);
    expect((await fetch(entry, { headers })).status).toBe(404);
  } finally {
    await server.close();
    await f.close();
  }
});

test('a shared stream manifest generates on first use and serves the complete chunk graph', async () => {
  const f = await fixture();
  const source = path.join(f.source, 'triangle.obj');
  fs.writeFileSync(source, 'o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const model = (await f.library.importFile({ path: source })).model!;
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    acquisition: acquisitionOptions(),
  });
  const run = vi.spyOn(ConversionRunner.prototype, 'run');
  try {
    const client = await ServerModelsClient.open(server.url);
    const available = await client.availableFormats(model.id);
    const option = available.formats.find((item) => item.format === 'xgfstream')!;
    const entry = client.hotloadUrl(model.id, option.format, option.entrypoint);
    expect(entry).toMatch(/\/xgfstream\/files\/index.runtime.json$/);
    expect(option.cached).toBe(false);
    expect(run.mock.calls.every(([request]) => !request.format)).toBe(true);
    const manifest = await fetch(entry, { headers });
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('access-control-allow-origin')).toBe('*');
    expect((await manifest.json()).format).toBe('XGFStreamingRuntimeIndex');
    const index = await (await fetch(new URL('index.json', entry), { headers })).json();
    expect(index.chunks.length).toBeGreaterThan(0);
    for (const chunk of index.chunks) {
      const file = await fetch(new URL(chunk.uri, entry), { headers });
      expect(file.status).toBe(200);
      expect(file.headers.get('access-control-allow-origin')).toBe('*');
      expect([2, 3]).toContain(Buffer.from(await file.arrayBuffer()).readUInt32LE(0));
    }
    await fetch(entry, { headers });
    expect(run.mock.calls.filter(([request]) => request.format === 'xgfstream')).toHaveLength(1);
    expect((await fetch(new URL('manifest.json', entry), { headers })).status).toBe(404);
    await f.library.delete(model.id);
    expect((await fetch(entry, { headers })).status).toBe(404);
    expect((await fetch(new URL(index.chunks[0].uri, entry), { headers })).status).toBe(404);
  } finally {
    run.mockRestore();
    await server.close();
    await f.close();
  }
});
