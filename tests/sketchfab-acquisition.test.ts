import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
import { response } from './acquisition-helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { SketchfabArchive } from '../src/acquisition/SketchfabArchive.js';
import type { HttpTransport } from '../src/providers/HttpsTransport.js';

async function zip(file: string, files: Record<string, Buffer>) {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(files)) zip.addBuffer(bytes, name);
  zip.end();
  await pipeline(zip.outputStream, fs.createWriteStream(file));
  return fs.readFileSync(file);
}

test('Models restores its saved account at startup and imports a signed Sketchfab archive through persistent plans', async () => {
  const f = await fixture();
  const model = JSON.parse(
    fs.readFileSync(new URL('./fixtures/sketchfab-model.json', import.meta.url), 'utf8'),
  );
  const licenses = fs.readFileSync(new URL('./fixtures/sketchfab-licenses.json', import.meta.url));
  const bytes = await zip(path.join(f.source, 'model.zip'), { 'scene.gltf': gltf });
  let signedRequests = 0,
    transfers = 0;
  const transport: HttpTransport = {
    async request(url, input) {
      if (url.hostname === 'sketchfab-prod-media.s3.amazonaws.com') {
        transfers++;
        expect(input.headers.Authorization).toBeUndefined();
        return response(bytes);
      }
      if (url.pathname === '/v3/me') {
        expect(input.headers.Authorization).toBe('Token test-secret');
        return response(Buffer.from('{"username":"fixture-user"}'));
      }
      if (url.pathname.endsWith('/download')) {
        expect(input.headers.Authorization).toBe('Token test-secret');
        return response(
          Buffer.from(
            JSON.stringify({
              gltf: {
                size: bytes.length,
                expires: 300,
                url: `https://sketchfab-prod-media.s3.amazonaws.com/archives/${model.uid}/gltf/model.zip?signature=${++signedRequests}`,
              },
            }),
          ),
        );
      }
      expect(input.headers.Authorization).toBeUndefined();
      if (url.pathname === '/v3/licenses') return response(licenses);
      expect(url.pathname).toBe('/v3/models/' + model.uid);
      return response(Buffer.from(JSON.stringify(model)));
    },
  };
  const options = {
    root: f.directory,
    port: 0,
    acquisition: { transport, pacing: { sketchfab: 0 }, retries: 0 },
  };
  let server = await startModelBrowser(options);
  const headers = { 'Content-Type': 'application/json', 'X-Models-Action': 'explicit' };
  const request = async (route: string, value?: unknown) => {
    const response = await fetch(
      server.url + '/api/acquisition/' + route,
      value === undefined ? {} : { method: 'POST', headers, body: JSON.stringify(value) },
    );
    const body = await response.json();
    expect(body, route).not.toHaveProperty('error');
    expect(JSON.stringify(body)).not.toContain('test-secret');
    return body.data;
  };
  try {
    expect((await request('providers')).find((p: any) => p.id === 'sketchfab').acquisition).toBe(
      'website',
    );
    expect(
      (await fetch(server.url + '/api/acquisition/sketchfab/auth', { method: 'POST' })).status,
    ).toBe(409);
    expect(
      (
        await fetch(server.url + '/api/acquisition/sketchfab/auth', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://untrusted.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    await request('sketchfab/auth', { method: 'api-token', token: 'test-secret' });
    await server.close();
    server = await startModelBrowser(options);
    expect(await request('sketchfab/auth')).toMatchObject({
      configured: true,
      username: 'fixture-user',
    });
    expect((await request('providers')).find((p: any) => p.id === 'sketchfab').acquisition).toBe(
      'direct',
    );
    const plan = await request('plans', {
      providers: ['sketchfab'],
      assets: [{ provider: 'sketchfab', remoteId: model.uid }],
      resolutions: 'all',
    });
    expect(plan.items).toHaveLength(1);
    expect(JSON.stringify(plan)).not.toContain('signature=');
    expect(plan.items[0].expectedLicense.id).toBe('CC-BY-4.0');
    expect(transfers).toBe(0);
    const job = await request('plans/' + plan.id + '/execute', { confirmed: true });
    let finished = job;
    for (let attempt = 0; attempt < 200; attempt++) {
      finished = await request('jobs/' + job.id);
      if (!['pending', 'running'].includes(finished.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(finished, JSON.stringify(finished.items)).toMatchObject({
      status: 'completed',
      completedItems: 1,
      downloadedBytes: bytes.length,
    });
    expect(transfers).toBe(1);
    expect(signedRequests).toBeGreaterThanOrEqual(3);
    const imported = (await f.library.list())[0];
    expect(imported.metadata.source).toMatchObject({
      provider: 'sketchfab',
      remoteId: model.uid,
      license: 'CC-BY-4.0',
    });
    expect(imported.metadata.source?.attribution).toContain('Seesha');
    expect(imported.files.some((file) => file.path === 'scene.gltf')).toBe(true);
    expect(await request('plans/' + plan.id)).toEqual(plan);
    await request('sketchfab/disconnect', {});
    await server.close();
    server = await startModelBrowser(options);
    expect(await request('sketchfab/auth')).toEqual({ configured: false });
  } finally {
    await server.close();
    await f.close();
  }
});

test('Sketchfab archives require the documented entrypoint and retain archive safety checks', async () => {
  const f = await fixture();
  try {
    const archive = new SketchfabArchive();
    const file = path.join(f.source, 'archive.zip');
    await zip(file, { 'model.gltf': gltf });
    await expect(archive.prepare(file, f.source)).rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
    await zip(file, { 'scene.gltf': gltf, 'manifest.json': Buffer.from('{}') });
    await expect(archive.prepare(file, f.source)).rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
    await zip(file, { 'scene.gltf': gltf, 'bomb.bin': Buffer.alloc(1024 * 1024) });
    await expect(archive.prepare(file, f.source)).rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
  } finally {
    await f.close();
  }
});
