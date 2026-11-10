import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { acquisitionOptions } from './acquisition-helpers.js';
test('browser upload, model routes, package links, byte ranges, CORS and mutations', async () => {
  const f = await fixture(),
    server = await startModelBrowser({
      root: f.directory,
      appDirectory: path.resolve('build/app'),
      port: 0,
      allowedOrigins: ['http://viewer.example'],
      acquisition: acquisitionOptions(),
    });
  const headers = { 'X-Models-Action': 'explicit', 'Content-Type': 'application/json' };
  try {
    const base = server.url;
    const page = await fetch(base + '/');
    expect(page.status).toBe(200);
    const csp = page.headers.get('content-security-policy')!;
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(base + '/picker')).headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(base + '/models-client.js')).headers.get('cache-control')).toBe('no-cache');
    const moduleUrl = (await page.text()).match(/src="([^"]+\.js)"/)![1];
    const module = await fetch(new URL(moduleUrl, base));
    expect(module.status).toBe(200);
    expect(module.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const session = await (await fetch(base + '/api/imports', { method: 'POST', headers })).json();
    expect(session.ok).toBe(true);
    expect(
      (
        await fetch(base + '/api/imports/' + session.data.id + '/files?path=scene.gltf', {
          method: 'PUT',
          headers,
          body: new Uint8Array(gltf),
        })
      ).status,
    ).toBe(200);
    const imported = await (
      await fetch(base + '/api/imports/' + session.data.id + '/commit', {
        method: 'POST',
        headers,
        body: JSON.stringify({ entrypoint: 'scene.gltf', name: 'Browser model' }),
      })
    ).json();
    expect(imported.ok).toBe(true);
    const model = imported.data.model;
    const file = base + '/api/models/' + model.id + '/files/scene.gltf';
    expect(await (await fetch(file)).text()).toBe(gltf.toString());
    const range = await fetch(file, { headers: { Range: 'bytes=0-3' } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe(gltf.subarray(0, 4).toString());
    const cors = await fetch(file, { headers: { Origin: 'http://viewer.example' } });
    expect(cors.headers.get('access-control-allow-origin')).toBe('http://viewer.example');
    expect((await fetch(file, { headers: { Origin: 'http://evil.example' } })).status).toBe(403);
    expect((await fetch(base + '/api/models/' + model.id, { method: 'DELETE' })).status).toBe(409);
    expect((await fetch(base + '/api/models/' + model.id + '/bundle')).status).toBe(200);
    const patch = await fetch(base + '/api/models/' + model.id, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Edited', tags: ['test'] }),
    });
    expect(patch.status).toBe(200);
    expect((await f.library.get(model.id))?.metadata.name).toBe('Edited');
    expect(
      (await fetch(base + '/api/models/' + model.id, { method: 'DELETE', headers })).status,
    ).toBe(200);
    expect(await f.library.list()).toEqual([]);
  } finally {
    await server.close();
    await f.close();
  }
});
