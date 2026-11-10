import fs from 'node:fs';
import { expect, test } from 'vitest';
import { SketchfabProvider } from '../src/providers/SketchfabProvider.js';
import { SmithsonianProvider } from '../src/providers/SmithsonianProvider.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { ProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { FederatedSearchService } from '../src/providers/FederatedSearchService.js';
import { providerUrl } from '../src/providers/HostPolicy.js';
import { response } from './acquisition-helpers.js';
import { fixture } from './helpers.js';
const fixtureBytes = (name: string) =>
  fs.readFileSync(new URL('./fixtures/' + name + '.json', import.meta.url));
function http() {
  return new ProviderHttpClient({
    pacing: { polyhaven: 0, sketchfab: 0, smithsonian: 0 },
    transport: {
      async request(url) {
        if (url.hostname === 'api.sketchfab.com')
          return response(
            fixtureBytes(
              url.pathname.endsWith('/licenses') ? 'sketchfab-licenses' : 'sketchfab-search',
            ),
          );
        return response(
          fixtureBytes(
            url.searchParams.has('model_url') ? 'smithsonian-model' : 'smithsonian-search',
          ),
        );
      },
    },
  });
}
test('Sketchfab exposes public discovery, archive sizes and real license labels without pretending downloads are authenticated', async () => {
  const provider = new SketchfabProvider(http());
  const result = await provider.search({ text: 'chair', limit: 2 });
  expect(result.items).toHaveLength(2);
  expect(result.nextCursor).toBe('2');
  expect(result.items[0].statistics?.polygonCount).toBe(999786);
  expect(result.items[1].license.id).toBe('by');
  expect(
    result.items[1].downloadOptions?.some(
      (option) => option.format === 'glb' && option.sizeBytes === 89866620,
    ),
  ).toBe(true);
  await expect(provider.getDownloads(result.items[0].remoteId)).rejects.toMatchObject({
    code: 'DOWNLOAD_OPTION_NOT_FOUND',
  });
});
test('Smithsonian groups model files and preserves distinct directly downloadable GLB variants', async () => {
  const provider = new SmithsonianProvider(http());
  const found = await provider.search({ text: 'chair' });
  expect(found.items).toHaveLength(2);
  const id = 'ff607e3c-3d88-4422-a246-3976aa4839dc';
  const info = await provider.getModel(id);
  expect(info.license.id).toBe('CC0-1.0');
  expect(info.previewUrl).toContain('scene-image-thumb.jpg');
  const downloads = await provider.getDownloads(id);
  expect(downloads).toHaveLength(2);
  expect(downloads[0].estimatedBytes).toBe(1461828);
  expect(downloads[0].files[0].filename).toContain('(');
  expect(downloads[0].resolution).not.toBe(downloads[1].resolution);
});
test('Smithsonian manifests fit immutable planning without inventing missing geometry counts', async () => {
  const f = await fixture();
  try {
    const registry = new ProviderRegistry(http());
    const service = await f.library.acquisition({ providers: registry });
    const plan = await service.createPlan({
      providers: ['smithsonian'],
      assets: [{ provider: 'smithsonian', remoteId: 'ff607e3c-3d88-4422-a246-3976aa4839dc' }],
      resolutions: 'all',
      maxPackageBytes: 2 * 1024 ** 2,
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].format).toBe('glb');
    expect(plan.items[0].files[0].sizeBytes).toBe(1461828);
    expect(plan.items[0].warnings[0].code).toBe('NO_PROVIDER_CHECKSUM');
    expect(await service.importPlan(plan)).toEqual(plan);
    expect(await f.library.list()).toEqual([]);
  } finally {
    await f.close();
  }
});
test('federated discovery returns available providers after one fails and allows only verified hosts', async () => {
  const registry = new ProviderRegistry(http());
  registry.register({
    id: 'polyhaven',
    async search() {
      throw Error('offline');
    },
    async getModel() {
      throw Error('offline');
    },
    async getDownloads() {
      return [];
    },
  });
  const found = await new FederatedSearchService(registry).search({ text: 'chair', limit: 10 });
  expect(new Set(found.items.map((model) => model.provider))).toEqual(
    new Set(['smithsonian', 'sketchfab']),
  );
  expect(found.providerErrors.map((error) => error.provider)).toContain('polyhaven');
  expect(() =>
    providerUrl('sketchfab', 'https://media.sketchfab.com/models/example/thumb.jpg', 'preview'),
  ).not.toThrow();
  expect(() => providerUrl('sketchfab', 'https://media.sketchfab.com/private')).toThrow();
  expect(() => providerUrl('smithsonian', 'https://3d-api.si.edu/admin')).toThrow();
});
