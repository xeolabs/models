import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.js';
import { Database } from '../src/storage/Database.js';
import { AcquisitionPlanRepository } from '../src/acquisition/AcquisitionPlanRepository.js';
import { AcquisitionPlanner } from '../src/acquisition/AcquisitionPlanner.js';
import { ProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { cc0 } from '../src/providers/validation.js';
import { fingerprint, validatePlan } from '../src/acquisition/planSchema.js';
import type { ModelProvider } from '../src/providers/types.js';
const model = (id: string) => ({
  provider: 'polyhaven' as const,
  remoteId: id,
  name: id,
  tags: ['wood'],
  license: { ...cc0 },
  sourceUrl: 'https://polyhaven.com/a/' + id,
});
function provider(size: number | undefined = 10): ModelProvider {
  return {
    id: 'polyhaven',
    async search() {
      return { items: [model('oak'), model('oak'), model('pine')] };
    },
    async getModel(id) {
      return model(id);
    },
    async getDownloads(id) {
      return [
        {
          id: '2k-gltf',
          resolution: '2k',
          format: 'gltf',
          files: [
            {
              role: 'entrypoint',
              filename: id + '.gltf',
              url: 'https://dl.polyhaven.org/file/ph-assets/Models/' + id + '.gltf',
              sizeBytes: size,
            },
          ],
        },
      ];
    },
  };
}
test('plans are persistent immutable snapshots with stable fingerprints and no binary requests', async () => {
  const f = await fixture(),
    db = new Database(f.directory);
  try {
    const registry = new ProviderRegistry();
    registry.register(provider());
    const repo = new AcquisitionPlanRepository(db),
      planner = new AcquisitionPlanner(registry, repo);
    const input = { providers: ['polyhaven' as const], resolution: '2k', maxModels: 2 };
    const a = await planner.create(input),
      b = await planner.create(input);
    expect(a.id).not.toBe(b.id);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.items).toHaveLength(2);
    expect(a.summary.knownBytes).toBe(20);
    expect(repo.list({ limit: 1 }).total).toBe(2);
    expect(repo.get(a.id)).toEqual(a);
    expect(() =>
      db.sql.prepare('UPDATE acquisition_plans SET fingerprint=? WHERE id=?').run('changed', a.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.sql.prepare('UPDATE acquisition_plan_items SET ordinal=3 WHERE id=?').run(a.items[0].id),
    ).toThrow(/immutable/);
    const changed = structuredClone(a);
    changed.criteria.maxTotalBytes++;
    expect(() => validatePlan(changed)).toThrow();
    const json = JSON.parse(JSON.stringify(a));
    expect(repo.save(json)).toEqual(a);
    expect(await f.library.list()).toHaveLength(0);
    expect(() => repo.list({ offset: -1 })).toThrow();
    expect(() => repo.require(randomUUID())).toThrow();
    const unsafe = structuredClone(a);
    unsafe.items[0].files[0].url = 'https://127.0.0.1/a';
    unsafe.fingerprint = fingerprint(unsafe);
    expect(() => validatePlan(unsafe)).toThrow();
  } finally {
    db.sql.close();
    await f.close();
  }
});
test('planning enforces quotas, selected bytes and explicit unknown-size policy', async () => {
  const f = await fixture(),
    db = new Database(f.directory);
  try {
    const registry = new ProviderRegistry();
    registry.register(provider());
    const planner = new AcquisitionPlanner(registry, new AcquisitionPlanRepository(db));
    const plan = await planner.create({
      providers: ['polyhaven'],
      resolution: '2k',
      selections: [{ query: 'wood', maxModels: 1 }],
      maxTotalBytes: 10,
    });
    expect(plan.items).toHaveLength(1);
    const limited = await planner.create({
      providers: ['polyhaven'],
      resolution: '2k',
      maxTotalBytes: 10,
    });
    expect(limited.items).toHaveLength(1);
    expect(limited.warnings[0].code).toBe('ACQUISITION_LIMIT_EXCEEDED');
    registry.register(provider(undefined));
    // The fixture's default parameter represents known size; remove it explicitly for this case.
    const unknown = provider();
    unknown.getDownloads = async () => [
      {
        id: '2k-gltf',
        resolution: '2k',
        format: 'gltf',
        files: [
          {
            role: 'entrypoint',
            filename: 'a.gltf',
            url: 'https://dl.polyhaven.org/file/ph-assets/Models/a.gltf',
          },
        ],
      },
    ];
    registry.register(unknown);
    await expect(
      planner.create({ providers: ['polyhaven'], resolution: '2k' }),
    ).rejects.toMatchObject({ code: 'ACQUISITION_LIMIT_EXCEEDED' });
    const accepted = await planner.create({
      providers: ['polyhaven'],
      resolution: '2k',
      allowUnknownSizes: true,
    });
    expect(accepted.summary.unknownSizeFiles).toBe(2);
    await expect(
      planner.create({ providers: ['polyhaven'], resolution: '4k' }),
    ).rejects.toMatchObject({ code: 'DOWNLOAD_OPTION_NOT_FOUND' });
  } finally {
    db.sql.close();
    await f.close();
  }
});
