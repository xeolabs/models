import { expect, test } from 'vitest';
import { packageBytes, matchesModel, matchingDownloads } from '../app/stores/providerStatistics.js';
import { fakeProvider, acquisitionOptions, remote } from './acquisition-helpers.js';
import { fixture } from './helpers.js';
import { fingerprint } from '../src/acquisition/planSchema.js';
test('download and polygon filters exclude unknown values and compare coherent format/resolution packages', async () => {
  const sets = await fakeProvider().getDownloads('oak');
  sets[0].files[0].sizeBytes = 100;
  sets[0].files.push({
    ...sets[0].files[0],
    filename: 'image.png',
    role: 'resource',
    sizeBytes: 200,
  });
  expect(packageBytes(sets[0])).toBe(300);
  const m = { ...remote('oak'), statistics: { polygonCount: 500 } },
    filters = { format: 'gltf', resolution: '2k', maxBytes: 300, maxPolygons: 500, tag: 'wood' };
  expect(matchesModel(m, sets, filters)).toBe(true);
  expect(matchesModel(m, sets, { ...filters, maxBytes: 299 })).toBe(false);
  expect(matchesModel(m, sets, { ...filters, maxPolygons: 499 })).toBe(false);
  expect(matchesModel(remote('unknown'), sets, filters)).toBe(false);
  expect(matchingDownloads(sets, { ...filters, resolution: '4k' })).toEqual([]);
  sets[0].files[0].sizeBytes = undefined;
  expect(packageBytes(sets[0])).toBeUndefined();
  expect(matchesModel(m, sets, filters)).toBe(false);
});
test('saved plans preserve size and polygon criteria and reject tampered limits', async () => {
  const f = await fixture();
  try {
    const provider = fakeProvider();
    provider.getModel = async (id) => ({ ...remote(id), statistics: { polygonCount: 500 } });
    const original = provider.getDownloads;
    provider.getDownloads = async (id) => {
      const sets = await original(id);
      return [
        ...sets,
        {
          ...sets[0],
          id: '4k-gltf',
          resolution: '4k',
          files: sets[0].files.map((file) => ({ ...file, sizeBytes: 1000000 })),
        },
      ];
    };
    const a = await f.library.acquisition(acquisitionOptions(provider));
    const plan = await a.createPlan({
      providers: ['polyhaven'],
      resolutions: 'all',
      maxPackageBytes: 1024,
      maxPolygons: 500,
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].resolution).toBe('2k');
    expect(plan.criteria.maxPackageBytes).toBe(1024);
    expect((await a.executePlan(plan.id)).status).toBe('completed');
    const bad = structuredClone(plan);
    bad.criteria.maxPolygons = 499;
    bad.fingerprint = fingerprint(bad);
    await expect(a.importPlan(bad)).rejects.toMatchObject({ code: 'INVALID_PLAN' });
  } finally {
    await f.close();
  }
});
