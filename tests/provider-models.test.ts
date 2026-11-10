import fs from 'node:fs';
import { expect, test } from 'vitest';
import { PolyHavenProvider } from '../src/providers/PolyHavenProvider.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { response } from './acquisition-helpers.js';
test('actual Poly Haven model manifests retain package paths for dependencies', async () => {
  const provider = new PolyHavenProvider(
    new ProviderHttpClient({
      pacing: { polyhaven: 0 },
      transport: {
        async request(url) {
          return response(
            fs.readFileSync(
              new URL(
                './fixtures/poly-' +
                  (url.pathname.startsWith('/files/') ? 'files' : 'info') +
                  '.json',
                import.meta.url,
              ),
            ),
          );
        },
      },
    }),
  );
  const model = await provider.getModel('ArmChair_01');
  expect(model.provider).toBe('polyhaven');
  const sets = await provider.getDownloads('ArmChair_01'),
    gltf = sets.find((s) => s.resolution === '1k' && s.format === 'gltf')!;
  expect(gltf.files).toHaveLength(5);
  expect(gltf.files.some((f) => f.packagePath === 'ArmChair_01.bin')).toBe(true);
  expect(gltf.files.some((f) => f.packagePath?.startsWith('textures/'))).toBe(true);
  expect(gltf.files.every((f) => f.checksum?.algorithm === 'md5')).toBe(true);
});
