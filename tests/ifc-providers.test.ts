import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { BuildingSmartProvider } from '../src/providers/BuildingSmartProvider.js';
import { BuildingSmartCommunityProvider } from '../src/providers/BuildingSmartCommunityProvider.js';
import { ProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { providerUrl } from '../src/providers/HostPolicy.js';
import { freeLicense, ccBy } from '../src/providers/validation.js';
import type { HttpTransport } from '../src/providers/HttpsTransport.js';
import { response } from './acquisition-helpers.js';
import { fixture } from './helpers.js';
const bytes = (name: string) =>
  fs.readFileSync(new URL('./fixtures/ifc-providers/' + name, import.meta.url));
const json = (name: string) => JSON.parse(bytes(name).toString());
const identity = (value: string) => createHash('sha256').update(value).digest('hex');
function setup(community = false, pointer?: Buffer) {
  const name = community ? 'Community-Sample-Test-Files' : 'Certification-datasets';
  const data = json(name + '.json');
  const notices = json('community-notices.json') as Record<string, string>;
  const calls: URL[] = [];
  const source = bytes('Building-Architecture.ifc');
  const transport: HttpTransport = {
    async request(url) {
      calls.push(url);
      if (url.hostname === 'api.github.com')
        return response(
          Buffer.from(JSON.stringify(url.pathname.includes('/commits/') ? data.commit : data.tree)),
        );
      const entryPath = decodeURIComponent(
        url.pathname
          .split('/')
          .slice(url.hostname === 'media.githubusercontent.com' ? 5 : 4)
          .join('/'),
      );
      if (url.hostname === 'media.githubusercontent.com') return response(source);
      if (entryPath.endsWith('.ifc')) {
        if (community)
          return response(
            pointer ??
              Buffer.from(
                `version https://git-lfs.github.com/spec/v1\noid sha256:${identity(source.toString())}\nsize ${source.length}\n`,
              ),
          );
        return response(source);
      }
      if (!community) return response(bytes('LICENSE.txt'));
      const notice = notices[entryPath];
      if (!notice) throw new Error('Unexpected fixture URL: ' + url);
      return response(Buffer.from(notice));
    },
  };
  const http = new ProviderHttpClient({
    transport,
    retries: 0,
    pacing: { buildingsmart: 0, 'buildingsmart-community': 0 },
  });
  const provider = community
    ? new BuildingSmartCommunityProvider(http)
    : new BuildingSmartProvider(http);
  return { provider, http, calls, data, transport, source };
}
test('certification discovery exposes IFC sizes, bounded pages and commit-pinned manifests without downloading models', async () => {
  const f = setup();
  const found = await f.provider.search({ limit: 1 });
  expect(found.items).toHaveLength(1);
  expect(found.nextCursor).toBe('1');
  expect(found.total).toBe(2);
  expect(found.items[0].downloadOptions?.[0]).toMatchObject({
    format: 'ifc',
    resolution: 'original',
  });
  expect(found.items[0].downloadOptions?.[0].sizeBytes).toBeGreaterThan(90000);
  expect(found.items[0].statistics?.polygonCount).toBeUndefined();
  const second = await f.provider.search({ cursor: found.nextCursor, limit: 1 });
  expect(second.items[0].remoteId).not.toBe(found.items[0].remoteId);
  const model = await f.provider.getModel(found.items[0].remoteId);
  expect(model.license).toEqual(ccBy);
  const download = (await f.provider.getDownloads(model.remoteId))[0];
  expect(download.files[0].url).toContain(f.data.commit.sha);
  expect(download.files[0].checksum).toBeUndefined();
  expect(download.files.some((file) => file.packagePath?.startsWith('provenance/'))).toBe(true);
  expect(f.calls.some((url) => url.pathname.endsWith('.ifc'))).toBe(false);
  expect((await f.provider.search({ text: 'no-match' })).items).toEqual([]);
  await expect(f.provider.getModel('missing')).rejects.toMatchObject({
    code: 'REMOTE_MODEL_NOT_FOUND',
  });
});
test('community search resolves LFS metadata into real sizes and SHA-256, retaining original credit files', async () => {
  const f = setup(true, bytes('community-pointer.txt'));
  const found = await f.provider.search({ text: 'duplex', limit: 1 });
  const download = (await f.provider.getDownloads(found.items[0].remoteId))[0];
  expect(download.files[0]).toMatchObject({
    sizeBytes: 2380763,
    checksum: {
      algorithm: 'sha256',
      value: 'b347a2c8aa8fff6db896a4417a9c50c22ac0ccd7c5cfc22b99b8d29336c606ed',
    },
  });
  expect(download.files[0].url).toContain('https://media.githubusercontent.com/media/');
  expect(download.files.filter((file) => file.role === 'resource').length).toBeGreaterThan(1);
  expect(f.calls.some((url) => url.hostname === 'media.githubusercontent.com')).toBe(false);
  const pointerReads = f.calls.filter((url) => url.pathname.endsWith('.ifc')).length;
  await f.provider.getDownloads(found.items[0].remoteId);
  expect(f.calls.filter((url) => url.pathname.endsWith('.ifc')).length).toBe(pointerReads);
});
test('IFC acquisition retains bytes and credits and atomically schedules optional preparation', async () => {
  const f = await fixture(),
    remote = setup(true);
  try {
    await f.library.configureProcessing({ automaticIFC: true, paused: true });
    const providers = new ProviderRegistry(remote.http);
    providers.register(remote.provider);
    const service = await f.library.acquisition({
      providers,
      transport: remote.transport,
      retries: 0,
      pacing: { 'buildingsmart-community': 0 },
    });
    const found = await remote.provider.search({ limit: 1 });
    const plan = await service.createPlan({
      providers: ['buildingsmart-community'],
      assets: [{ provider: 'buildingsmart-community', remoteId: found.items[0].remoteId }],
      resolution: 'original',
      format: 'ifc',
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].expectedLicense.attributionRequired).toBe(true);
    expect(await service.importPlan(plan)).toEqual(plan);
    expect(await f.library.list()).toEqual([]);
    const job = await service.executePlan(plan.id);
    expect(job.status).toBe('completed');
    const models = await f.library.list();
    expect(models).toHaveLength(1);
    expect(models[0].format).toBe('ifc');
    expect((await f.library.processing()).jobs).toEqual([
      expect.objectContaining({
        modelId: models[0].id,
        kind: 'prepare-ifc',
        status: 'queued',
        source: 'automatic',
      }),
    ]);
    expect(models[0].metadata.source.license).toBe('CC-BY-4.0');
    expect(models[0].metadata.source.attribution).toContain(ccBy.url);
    expect(models[0].files.some((file) => file.path.startsWith('provenance/'))).toBe(true);
    expect(
      fs.readFileSync((await f.library.resolveFile(models[0].id, models[0].entrypoint!)).path),
    ).toEqual(remote.source);
    expect(await service.getPlan(plan.id)).toEqual(plan);
  } finally {
    await f.close();
  }
});
test('unsafe or incomplete repository metadata is rejected, including license changes', async () => {
  for (const mode of ['truncated', 'unsafe', 'license', 'override'] as const) {
    const f = setup();
    if (mode === 'truncated') f.data.tree.truncated = true;
    if (mode === 'unsafe') f.data.tree.tree[0].path = '../outside.ifc';
    if (mode === 'license')
      f.data.tree.tree = f.data.tree.tree.filter(
        (entry: { path: string }) => entry.path !== 'LICENSE',
      );
    if (mode === 'override') {
      const file = f.data.tree.tree.find((entry: { path: string }) => entry.path.endsWith('.ifc'));
      f.data.tree.tree.push({ ...file, path: file.path.replace(/[^/]+$/, 'LICENSE') });
    }
    await expect(f.provider.search({ limit: 1 })).rejects.toMatchObject({
      code: ['license', 'override'].includes(mode)
        ? 'UNSUPPORTED_LICENSE'
        : 'INVALID_PROVIDER_RESPONSE',
    });
  }
});
test('symlink IFC files and unreviewed community folders are never discovered', async () => {
  const f = setup(true);
  const original = f.data.tree.tree.find((entry: { path: string }) => entry.path.endsWith('.ifc'));
  f.data.tree.tree.push({ ...original, path: 'restricted/unreviewed.ifc' });
  f.data.tree.tree.push({
    ...original,
    path: original.path.replace('.ifc', '-link.ifc'),
    mode: '120000',
  });
  expect((await f.provider.search({ limit: 20 })).total).toBe(2);
});
test('provider paths and explicit license requirements cannot be bypassed by imported plans', () => {
  for (const url of [
    'http://raw.githubusercontent.com/buildingSMART/Certification-datasets/main/a.ifc',
    'https://raw.githubusercontent.com/unrelated/project/main/a.ifc',
    'https://api.github.com/repos/buildingSMART/other/git/trees/main',
    'https://127.0.0.1/a.ifc',
    'https://media.githubusercontent.com/media/buildingSMART/Certification-datasets/main/%2e%2e/a.ifc',
  ])
    expect(() => providerUrl('buildingsmart', url)).toThrow();
  expect(freeLicense(ccBy)).toEqual(ccBy);
  expect(() => freeLicense({ ...ccBy, attributionRequired: false })).toThrow();
  expect(() => freeLicense({ ...ccBy, url: 'https://example.com/license' })).toThrow();
});
test('GitHub rate limits produce a stable error instead of retrying forbidden requests', async () => {
  let calls = 0;
  const http = new ProviderHttpClient({
    pacing: { buildingsmart: 0 },
    transport: {
      async request() {
        calls++;
        return { ...response(), status: 403, headers: { 'x-ratelimit-remaining': '0' } };
      },
    },
  });
  await expect(new BuildingSmartProvider(http).search({})).rejects.toMatchObject({
    code: 'RATE_LIMITED',
  });
  expect(calls).toBe(1);
});

test('invalid LFS hashes and overflowing sizes fail during planning metadata checks', async () => {
  for (const pointer of [
    'version https://git-lfs.github.com/spec/v1\noid sha256:bad\nsize 200\n',
    'version https://git-lfs.github.com/spec/v1\noid sha256:' +
      'a'.repeat(64) +
      '\nsize 99999999999999999999\n',
  ]) {
    const f = setup(true, Buffer.from(pointer));
    await expect(f.provider.search({ limit: 1 })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
  }
});

test('HTTP model details and download discovery accept the community provider identifier', async () => {
  const f = await fixture(),
    remote = setup(true);
  const providers = new ProviderRegistry(remote.http);
  providers.register(remote.provider);
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    acquisition: {
      providers,
      transport: remote.transport,
      pacing: { 'buildingsmart-community': 0 },
    },
  });
  try {
    const listed = await (await fetch(server.url + '/api/acquisition/providers')).json();
    expect(listed.data.map((provider: { id: string }) => provider.id)).toContain(
      'buildingsmart-community',
    );
    const found = await remote.provider.search({ limit: 1 });
    const base =
      server.url + '/api/acquisition/models/buildingsmart-community/' + found.items[0].remoteId;
    const details = await fetch(base),
      downloads = await fetch(base + '/downloads');
    expect(details.status).toBe(200);
    expect((await details.json()).data.license.id).toBe('CC-BY-4.0');
    expect(downloads.status).toBe(200);
    expect((await downloads.json()).data[0].format).toBe('ifc');
  } finally {
    await server.close();
    await f.close();
  }
});
