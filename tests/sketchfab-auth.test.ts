import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { response } from './acquisition-helpers.js';
import { SketchfabAuthentication } from '../src/server/SketchfabAuthentication.js';
import { SketchfabConfiguration } from '../src/server/SketchfabConfiguration.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { SketchfabDownloadAccess } from '../src/providers/SketchfabDownloadAccess.js';

const credential = { method: 'api-token' as const, token: 'test-secret' };
const options = { pacing: { sketchfab: 0 }, retries: 0 };
const json = (value: unknown) => response(Buffer.from(JSON.stringify(value)));

test('verified credentials survive restart, never appear in status, and failed replacements preserve the account', async () => {
  const f = await fixture();
  const seen: string[] = [];
  const http = new ProviderHttpClient({
    ...options,
    transport: {
      async request(url, input) {
        expect(url.href).toBe('https://api.sketchfab.com/v3/me');
        seen.push(input.headers.Authorization);
        return input.headers.Authorization.endsWith('bad-token')
          ? { ...response(), status: 401 }
          : json({ username: 'fixture-user' });
      },
    },
  });
  try {
    const auth = new SketchfabAuthentication(f.directory, http);
    expect(auth.status()).toEqual({ configured: false });
    await auth.connect(credential);
    expect(auth.status()).toMatchObject({
      configured: true,
      username: 'fixture-user',
      method: 'api-token',
    });
    expect(JSON.stringify(auth.status())).not.toContain(credential.token);
    const file = path.join(f.directory, '.credentials/sketchfab.json');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    const saved = fs.readFileSync(file, 'utf8');
    await expect(auth.connect({ ...credential, token: 'bad-token' })).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_REQUIRED',
    });
    expect(fs.readFileSync(file, 'utf8')).toBe(saved);
    await expect(
      auth.connect({ ...credential, token: 'secret\nInjected: secret' }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_CREDENTIALS' });
    const restarted = new SketchfabAuthentication(f.directory, http);
    expect(restarted.credential()).toEqual(credential);
    await restarted.verify();
    await restarted.connect({ method: 'oauth', token: 'oauth-secret' });
    expect(seen).toEqual([
      'Token test-secret',
      'Token bad-token',
      'Token test-secret',
      'Bearer oauth-secret',
    ]);
    restarted.disconnect();
    expect(fs.existsSync(file)).toBe(false);
    expect(new SketchfabAuthentication(f.directory, http).status()).toEqual({ configured: false });
  } finally {
    await f.close();
  }
});

test('unsafe saved credentials and symlinks fail closed without exposing their contents', async () => {
  const f = await fixture();
  try {
    const config = new SketchfabConfiguration(f.directory);
    config.save(credential, 'fixture-user');
    const file = path.join(f.directory, '.credentials/sketchfab.json');
    fs.chmodSync(file, 0o644);
    expect(() => new SketchfabConfiguration(f.directory)).toThrow(/owner-only/);
    fs.chmodSync(file, 0o600);
    fs.writeFileSync(file, 'broken-test-secret');
    expect(() => new SketchfabConfiguration(f.directory)).toThrow(
      'Saved Sketchfab configuration is invalid.',
    );
    fs.rmSync(file);
    const outside = path.join(f.source, 'unrelated');
    fs.writeFileSync(outside, 'untouched');
    fs.symlinkSync(outside, file);
    expect(() => config.save(credential, 'fixture-user')).toThrow(/symlink/);
    expect(() => config.clear()).toThrow(/symlink/);
    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched');
  } finally {
    await f.close();
  }
});

test('authenticated requests bypass caches and reject cross-origin redirects and invalid responses', async () => {
  let calls = 0;
  const cached: unknown[] = [];
  const http = new ProviderHttpClient({
    ...options,
    cache: {
      get: () => undefined,
      set: (...args: unknown[]) => {
        cached.push(args);
      },
    },
    transport: {
      async request() {
        calls++;
        return json({ username: 'fixture-user' });
      },
    },
  });
  for (let i = 0; i < 2; i++)
    await http.authenticatedJson(
      'sketchfab',
      'https://api.sketchfab.com/v3/me',
      'Token test-secret',
    );
  expect(calls).toBe(2);
  expect(cached).toEqual([]);
  for (const [status, code] of [
    [401, 'PROVIDER_AUTH_REQUIRED'],
    [403, 'PROVIDER_AUTH_FORBIDDEN'],
  ] as const) {
    const client = new ProviderHttpClient({
      ...options,
      transport: {
        async request() {
          return { ...response(), status };
        },
      },
    });
    await expect(
      client.authenticatedJson('sketchfab', 'https://api.sketchfab.com/v3/me', 'Token test-secret'),
    ).rejects.toMatchObject({ code });
  }
  const redirect = new ProviderHttpClient({
    ...options,
    transport: {
      async request(url) {
        expect(url.hostname).toBe('api.sketchfab.com');
        return {
          ...response(),
          status: 302,
          headers: { location: 'https://sketchfab-prod-media.s3.amazonaws.com/archives/private' },
        };
      },
    },
  });
  await expect(
    redirect.authenticatedJson('sketchfab', 'https://api.sketchfab.com/v3/me', 'Token test-secret'),
  ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  for (const bytes of [Buffer.from('invalid JSON'), Buffer.alloc(1024 * 1024 + 1)]) {
    const client = new ProviderHttpClient({
      ...options,
      transport: {
        async request() {
          return response(bytes);
        },
      },
    });
    await expect(
      client.authenticatedJson('sketchfab', 'https://api.sketchfab.com/v3/me', 'Token test-secret'),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  }
});

test('signed download links are refreshed and must belong to the selected model', async () => {
  const id = 'c741dcd8720f4a629de8681bdcd4529b';
  let sequence = 0,
    size = 20,
    host = 'sketchfab-prod-media.s3.amazonaws.com';
  const http = new ProviderHttpClient({
    ...options,
    transport: {
      async request(_url, input) {
        expect(input.headers.Authorization).toBe('Token test-secret');
        return json({
          gltf: {
            url: `https://${host}/archives/${id}/gltf/model.zip?signature=${++sequence}`,
            size,
            expires: 300,
          },
        });
      },
    },
  });
  const access = new SketchfabDownloadAccess(http, () => credential);
  const download = (await access.downloads(id))[0];
  expect(download.files[0].url).toBe(`https://api.sketchfab.com/v3/models/${id}/download`);
  expect(await access.resolve(download.files[0])).toContain('signature=2');
  expect(await access.resolve(download.files[0])).toContain('signature=3');
  size++;
  await expect(access.resolve(download.files[0])).rejects.toMatchObject({ code: 'PLAN_STALE' });
  host = '127.0.0.1';
  await expect(access.downloads(id)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  await expect(
    access.resolve({ ...download.files[0], filename: 'wrong.zip' }),
  ).rejects.toMatchObject({ code: 'INVALID_PLAN' });
});
