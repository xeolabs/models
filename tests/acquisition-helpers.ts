import { createHash } from 'node:crypto';
import { ProviderRegistry } from '../src/providers/ProviderRegistry.js';
import { cc0 } from '../src/providers/validation.js';
import type { ModelProvider } from '../src/providers/types.js';
import type { HttpTransport, HttpResponse } from '../src/providers/HttpsTransport.js';
import { gltf } from './helpers.js';
export const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function remote(id: string) {
  return {
    provider: 'polyhaven' as const,
    remoteId: id,
    name: id,
    tags: ['wood'],
    sourceUrl: `https://polyhaven.com/a/${id}`,
    license: { ...cc0 },
    author: 'Fixture author',
  };
}
export function fakeProvider(ids = ['oak']): ModelProvider {
  return {
    id: 'polyhaven',
    async search() {
      return { items: ids.map(remote) };
    },
    async getModel(id) {
      return remote(id);
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
              url: `https://dl.polyhaven.org/file/ph-assets/Models/${id}.gltf`,
              sizeBytes: gltf.length,
              checksum: { algorithm: 'sha256', value: hash(gltf) },
            },
          ],
        },
      ];
    },
  };
}
export function response(bytes: Buffer = gltf): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: (async function* () {
      yield bytes;
    })(),
    close() {},
  };
}
export function acquisitionOptions(
  provider = fakeProvider(),
  transport: HttpTransport = {
    async request() {
      return response();
    },
  },
) {
  const providers = new ProviderRegistry();
  providers.register(provider);
  return { providers, transport, pacing: { polyhaven: 0 }, retryBaseMs: 0 };
}
