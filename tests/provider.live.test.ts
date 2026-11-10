import { expect, test } from 'vitest';
import { fixture } from './helpers.js';
test.skipIf(process.env.MODELS_LIVE_TESTS !== '1')(
  'optional bounded live Poly Haven model import',
  async () => {
    const f = await fixture();
    try {
      const remote = await f.library.acquisition();
      const plan = await remote.createPlan({
        providers: ['polyhaven'],
        assets: [{ provider: 'polyhaven', remoteId: 'ArmChair_01' }],
        resolution: '1k',
        format: 'gltf',
        maxModels: 1,
        maxTotalBytes: 5 * 1024 ** 2,
      });
      const job = await remote.executePlan(plan.id);
      expect(job.status).toBe('completed');
      expect((await f.library.validate()).ok).toBe(true);
    } finally {
      await f.close();
    }
  },
  60000,
);
