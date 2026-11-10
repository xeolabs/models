import { z } from 'zod';
import { ProviderHttpClient } from './ProviderHttpClient.js';
import { providerUrl } from './HostPolicy.js';
import { response } from './validation.js';
import { fail } from '../domain/ModelsError.js';
import type { SketchfabCredentialSource } from './SketchfabCredential.js';
import type { ProviderDownload, ProviderDownloadFile } from './types.js';

const manifestSchema = z.object({
  gltf: z
    .object({
      url: z.string().url(),
      size: z.number().int().positive().optional(),
      expires: z.number().int().positive(),
    })
    .optional(),
});

/**
 * Plans retain a stable API locator. Signed archive URLs are obtained just before
 * transfer and stay in memory, since Sketchfab expires them after a few minutes.
 */
export class SketchfabDownloadAccess {
  constructor(
    private readonly http: ProviderHttpClient,
    private readonly credential: SketchfabCredentialSource,
  ) {}

  connected(): boolean {
    return !!this.credential();
  }

  private endpoint(id: string): string {
    if (!/^[a-f0-9]{32}$/.test(id))
      fail('INVALID_PROVIDER_RESPONSE', 'Sketchfab: invalid model ID');
    return 'https://api.sketchfab.com/v3/models/' + id + '/download';
  }

  private async manifest(id: string, signal?: AbortSignal) {
    const credential = this.credential();
    if (!credential)
      fail('PROVIDER_AUTH_REQUIRED', 'Connect your Sketchfab account before downloading.');
    const result = response(
      manifestSchema,
      await this.http.authenticatedJson(
        'sketchfab',
        this.endpoint(id),
        `${credential.method === 'oauth' ? 'Bearer' : 'Token'} ${credential.token}`,
        signal,
      ),
      'Sketchfab download response',
    );
    if (!result.gltf) fail('DOWNLOAD_OPTION_NOT_FOUND', 'Sketchfab: no glTF archive is available.');
    const download = result.gltf;
    const url = providerUrl('sketchfab', download.url);
    // A download response must point at this model's archive, not another API route.
    if (
      url.hostname !== 'sketchfab-prod-media.s3.amazonaws.com' ||
      !url.pathname.startsWith(`/archives/${id}/gltf/`)
    ) {
      fail('INVALID_PROVIDER_RESPONSE', 'Sketchfab: unexpected archive destination');
    }
    return download;
  }

  async downloads(id: string): Promise<ProviderDownload[]> {
    const manifest = await this.manifest(id);
    return [
      {
        id: 'gltf-original',
        resolution: 'original',
        format: 'gltf',
        files: [
          {
            role: 'archive',
            url: this.endpoint(id),
            filename: id + '.zip',
            sizeBytes: manifest.size,
          },
        ],
        estimatedBytes: manifest.size,
      },
    ];
  }

  async resolve(file: ProviderDownloadFile, signal?: AbortSignal): Promise<string> {
    const url = providerUrl('sketchfab', file.url);
    const match = /^\/v3\/models\/([a-f0-9]{32})\/download$/.exec(url.pathname);
    if (
      url.hostname !== 'api.sketchfab.com' ||
      url.search ||
      !match ||
      file.role !== 'archive' ||
      file.filename !== match[1] + '.zip'
    ) {
      fail('INVALID_PLAN', 'Sketchfab: invalid archive selection');
    }
    const manifest = await this.manifest(match[1], signal);
    if (file.sizeBytes !== undefined && manifest.size !== file.sizeBytes) {
      fail('PLAN_STALE', 'Sketchfab: archive size changed; create a new plan.');
    }
    return manifest.url;
  }
}
