import { expect, test } from 'vitest';
import { fixture, gltf } from './helpers.js';
import { fakeProvider, acquisitionOptions, response } from './acquisition-helpers.js';
import { Database } from '../src/storage/Database.js';
import { AcquisitionJobRepository } from '../src/acquisition/AcquisitionJobRepository.js';
import { fingerprint } from '../src/acquisition/planSchema.js';
test('one-item acquisitions reuse V1 imports, preserve provenance and detect duplicates', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const a = await f.library.acquisition(
      acquisitionOptions(undefined, {
        async request() {
          calls++;
          return response();
        },
      }),
    );
    const job = await a.acquire({
      provider: 'polyhaven',
      remoteId: 'oak',
      resolution: '2k',
      tags: ['floor'],
    });
    expect(job.status).toBe('completed');
    expect(job.downloadedBytes).toBe(gltf.length);
    const items = await a.getJobItems(job.id),
      model = await f.library.get(items[0].modelId!);
    expect(model?.metadata.source?.provider).toBe('polyhaven');
    expect(model?.files[0].path).toBe('oak.gltf');
    expect(model?.metadata.tags).toContain('floor');
    expect(
      (await a.acquire({ provider: 'polyhaven', remoteId: 'oak', resolution: '2k' })).skippedItems,
    ).toBe(1);
    expect(calls).toBe(1);
    expect(
      (await a.acquire({ provider: 'polyhaven', remoteId: 'oak', resolution: '2k', force: true }))
        .completedItems,
    ).toBe(1);
    expect(await f.library.list()).toHaveLength(2);
    const db = new Database(f.directory);
    expect((await db.one('SELECT count(*) AS n FROM model_acquisitions', []))!.n).toBe(2);
    expect((await db.one('SELECT count(*) AS n FROM assets', []))!.n).toBe(1);
    await db.close();
    await f.library.delete(model!.id);
    expect((await f.library.validate()).ok).toBe(true);
  } finally {
    await f.close();
  }
});
test('jobs preserve successful items across failures and never change their plans', async () => {
  const f = await fixture();
  try {
    const a = await f.library.acquisition(
      acquisitionOptions(fakeProvider(['oak', 'pine']), {
        async request(url) {
          return response(url.pathname.includes('pine') ? Buffer.from('corrupt') : gltf);
        },
      }),
    );
    const plan = await a.createPlan({ providers: ['polyhaven'], resolution: '2k' });
    const job = await a.executePlan(plan.id);
    expect(job.status).toBe('completed_with_errors');
    expect(job.completedItems).toBe(1);
    expect(job.failedItems).toBe(1);
    expect(await a.getPlan(plan.id)).toEqual(plan);
    expect(await f.library.list()).toHaveLength(1);
    expect((await a.listJobs()).total).toBe(1);
    expect((await a.listPlans()).total).toBe(1);
    expect((await a.resumeJob(job.id)).status).toBe('completed_with_errors');
  } finally {
    await f.close();
  }
});
test('changed licenses or files are stale, and unchanged expired plans are revalidated', async () => {
  const f = await fixture();
  try {
    const provider = fakeProvider();
    const a = await f.library.acquisition(acquisitionOptions(provider));
    const plan = await a.createPlan({ providers: ['polyhaven'], resolution: '2k' });
    const expired = structuredClone(plan);
    expired.id = crypto.randomUUID();
    expired.items.forEach((i) => (i.id = crypto.randomUUID()));
    expired.createdAt = '2020-01-01T00:00:00.000Z';
    expired.expiresAt = '2020-01-02T00:00:00.000Z';
    expired.fingerprint = fingerprint(expired);
    await a.importPlan(expired);
    expect((await a.executePlan(expired.id)).status).toBe('completed');
    const original = provider.getDownloads;
    provider.getDownloads = async (id) => {
      const d = await original(id);
      d[0].files[0].sizeBytes!++;
      return d;
    };
    const job = await a.executePlan(plan.id);
    expect(job.skippedItems).toBe(1);
    const forced = structuredClone(plan);
    forced.id = crypto.randomUUID();
    forced.items.forEach((i) => (i.id = crypto.randomUUID()));
    forced.criteria.skipExisting = false;
    forced.fingerprint = fingerprint(forced);
    await a.importPlan(forced);
    const stale = await a.executePlan(forced.id);
    expect((await a.getJobItems(stale.id))[0].status).toBe('stale');
  } finally {
    await f.close();
  }
});
test('cancelled and abandoned jobs resume without search or lost transfer accounting', async () => {
  const f = await fixture();
  try {
    const provider = fakeProvider(),
      controller = new AbortController();
    let cancel = true;
    const a = await f.library.acquisition(
      acquisitionOptions(provider, {
        async request() {
          return {
            status: 200,
            headers: {},
            body: (async function* () {
              yield gltf.subarray(0, 10);
              if (cancel) {
                controller.abort();
                yield gltf.subarray(10);
              } else yield gltf.subarray(10);
            })(),
            close() {},
          };
        },
      }),
    );
    const plan = await a.createPlan({ providers: ['polyhaven'], resolution: '2k' });
    const job = await a.executePlan(plan.id, { signal: controller.signal });
    expect(job.status).toBe('cancelled');
    expect(await f.library.list()).toHaveLength(0);
    cancel = false;
    provider.search = async () => {
      throw Error('Resume must not search');
    };
    const resumed = await a.resumeJob(job.id);
    expect(resumed.status).toBe('completed');
    expect(resumed.downloadedBytes).toBeGreaterThan(gltf.length);
    const db = new Database(f.directory),
      jobs = new AcquisitionJobRepository(db);
    const abandoned = await jobs.create(plan, {});
    await jobs.claim(abandoned.id);
    await db.query('UPDATE acquisition_jobs SET owner_json=$1 WHERE id=$2', [
      JSON.stringify({ ...jobs.owner, pid: 99999999 }),
      abandoned.id,
    ]);
    await db.close();
    expect((await a.resumeJob(abandoned.id)).status).toBe('completed');
  } finally {
    await f.close();
  }
});
