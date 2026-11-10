import fs from 'node:fs';
import { expect, test } from 'vitest';
import { SketchfabProvider } from '../src/providers/SketchfabProvider.js';
import { ProviderHttpClient } from '../src/providers/ProviderHttpClient.js';
import { response } from './acquisition-helpers.js';

const detail = JSON.parse(
  fs.readFileSync(new URL('./fixtures/sketchfab-model.json', import.meta.url), 'utf8'),
);
const search = JSON.parse(
  fs.readFileSync(new URL('./fixtures/sketchfab-search.json', import.meta.url), 'utf8'),
);
const licenses = JSON.parse(
  fs.readFileSync(new URL('./fixtures/sketchfab-licenses.json', import.meta.url), 'utf8'),
);
function provider(model = detail) {
  return new SketchfabProvider(
    new ProviderHttpClient({
      pacing: { sketchfab: 0 },
      transport: {
        async request(url) {
          const value = url.pathname.endsWith('/licenses')
            ? licenses
            : url.pathname.endsWith('/search')
              ? search
              : model;
          return response(Buffer.from(JSON.stringify(value)));
        },
      },
    }),
  );
}

test('real model details use a license URI and resolve to the same license as search UID references', async () => {
  expect(detail.license).not.toHaveProperty('uid');
  const adapter = provider();
  const found = (await adapter.search({ text: 'chair' })).items.find(
    (item) => item.remoteId === detail.uid,
  )!;
  const model = await adapter.getModel(detail.uid);
  expect(model.license).toEqual(found.license);
  expect(model.license).toMatchObject({ id: 'CC-BY-4.0', attributionRequired: true });
  expect(model.author).toBe('Seesha');
});

test('license identities must be present, valid and consistent rather than inferred from their labels', async () => {
  const references = [
    { label: 'CC Attribution' },
    {
      ...detail.license,
      uri: 'https://untrusted.example/v3/licenses/322a749bcfa841b29dff1e8a1bb74b0b',
    },
    { ...detail.license, uri: detail.license.uri + '?unexpected=1' },
    { ...detail.license, uid: '7c23a1ba438d4306920229c12afcb5f9' },
    { ...detail.license, uid: 123 },
  ];
  for (const license of references) {
    await expect(provider({ ...detail, license }).getModel(detail.uid)).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_RESPONSE',
    });
  }
});

test('unknown and restricted license references are not relabeled as free licenses', async () => {
  await expect(
    provider({
      ...detail,
      license: { label: 'CC0', uri: 'https://api.sketchfab.com/v3/licenses/' + '0'.repeat(32) },
    }).getModel(detail.uid),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_LICENSE' });
  const restricted = licenses.results.find((license: { slug: string }) => license.slug === 'by-nc');
  expect((await provider({ ...detail, license: restricted }).getModel(detail.uid)).license.id).toBe(
    'by-nc',
  );
});
