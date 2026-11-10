import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
import { acquisitionOptions } from './acquisition-helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';
import {
  isPickerMessage,
  pickerMessage,
  pickerUrl,
  readPickerRequest,
} from '../src/browser/ModelPickerProtocol.js';

test('picker requests and replies reject untrusted or malformed identities', () => {
  const requestId = randomUUID();
  const request = {
    requestId,
    origin: 'https://studio.example',
    formats: ['glb', 'ifc'],
    theme: 'light' as const,
  };
  expect(readPickerRequest(new URL(pickerUrl('https://models.example', request)).search)).toEqual(
    request,
  );
  expect(() =>
    pickerUrl('https://models.example', { ...request, origin: 'https://studio.example/elsewhere' }),
  ).toThrow();
  expect(() => readPickerRequest('?request=bad&origin=javascript:alert(1)')).toThrow();
  const message = pickerMessage(requestId, 'select', {
    modelId: randomUUID(),
    updatedAt: new Date().toISOString(),
  });
  expect(isPickerMessage(message, requestId)).toBe(true);
  expect(isPickerMessage(message, randomUUID())).toBe(false);
  expect(isPickerMessage({ ...message, modelId: '../secrets' }, requestId)).toBe(false);
  expect(isPickerMessage({ ...message, updatedAt: 'yesterday' }, requestId)).toBe(false);
  expect(isPickerMessage({ ...message, version: 2 }, requestId)).toBe(false);
});

test('picker access is opt-in, cross-origin reads work, and mutations stay same-origin', async () => {
  const f = await fixture();
  fs.writeFileSync(path.join(f.source, 'scene.gltf'), gltf);
  const imported = await f.library.importDirectory({ path: f.source, entrypoint: 'scene.gltf' });
  const origin = 'https://studio.example';
  const server = await startModelBrowser({
    root: f.directory,
    appDirectory: path.resolve('build/app'),
    port: 0,
    pickerOrigins: [origin],
    acquisition: acquisitionOptions(),
  });
  const closedServer = await startModelBrowser({
    root: f.directory,
    appDirectory: path.resolve('build/app'),
    port: 0,
    acquisition: acquisitionOptions(),
  });
  try {
    const noPicker = await fetch(closedServer.url + '/api/picker');
    expect((await noPicker.json()).data.allowedOrigins).toEqual([]);
    expect(noPicker.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const navigation = await fetch(server.url + '/picker', {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(navigation.status).toBe(200);
    expect(navigation.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'self' https://studio.example",
    );
    const capabilities = await fetch(server.url + '/api/picker', { headers: { Origin: origin } });
    expect(capabilities.headers.get('access-control-allow-origin')).toBe(origin);
    expect((await capabilities.json()).data.allowedOrigins).toEqual([origin]);
    expect(
      (
        await fetch(server.url + '/api/picker', {
          headers: { Origin: 'https://untrusted.example' },
        })
      ).status,
    ).toBe(403);
    const id = imported.model!.id;
    const client = await ServerModelsClient.open(server.url);
    expect(
      (await client.search({ formats: ['gltf', 'glb'] })).items.map((item) => item.id),
    ).toEqual([id]);
    expect((await client.search({ formats: ['ifc'] })).total).toBe(0);
    const file = await fetch(await client.entryUrl(id), { headers: { Origin: origin } });
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(gltf.toString());
    expect(() => client.fileUrl(id, '../secret')).toThrow();
    const write = await fetch(server.url + '/api/models/' + id, {
      method: 'DELETE',
      headers: { Origin: origin, 'X-Models-Action': 'explicit' },
    });
    expect(write.status).toBe(403);
    expect(await f.library.get(id)).not.toBeNull();
    const foreignJob = await fetch(server.url + '/api/acquisition/jobs', {
      headers: { Origin: origin },
    });
    expect(foreignJob.status).toBe(403);
    const ownWrite = await fetch(server.url + '/api/models/' + id, {
      method: 'PATCH',
      headers: {
        Origin: server.url,
        'X-Models-Action': 'explicit',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Edited inside Models' }),
    });
    expect(ownWrite.status).toBe(200);
  } finally {
    await server.close();
    await closedServer.close();
    await f.close();
  }
});
