import { z } from 'zod';
import { ProviderHttpClient } from './ProviderHttpClient.js';
import { response, cc0 } from './validation.js';
import { providerUrl } from './HostPolicy.js';
import { fail } from '../domain/ModelsError.js';
import type {
  ModelProvider,
  ProviderModel,
  ProviderSearchQuery,
  ProviderDownload,
  ProviderDownloadSummary,
} from './types.js';
const uid = z.string().regex(/^[a-f0-9]{32}$/);
const archive = z
  .object({
    size: z.number().nonnegative().nullable().optional(),
    textureMaxResolution: z.number().nonnegative().nullable().optional(),
  })
  .passthrough();
const modelSchema = z
  .object({
    uid,
    name: z.string(),
    viewerUrl: z.string().url(),
    isDownloadable: z.boolean(),
    isAgeRestricted: z.boolean().optional(),
    description: z.string().optional(),
    faceCount: z.number().int().nonnegative().optional(),
    vertexCount: z.number().int().nonnegative().optional(),
    publishedAt: z.string().optional(),
    tags: z.array(z.object({ name: z.string() })).default([]),
    categories: z.array(z.object({ name: z.string() })).default([]),
    user: z.object({ displayName: z.string().optional(), username: z.string() }).optional(),
    license: z.object({ uid, label: z.string() }).nullable(),
    thumbnails: z.object({
      images: z.array(z.object({ url: z.string().url(), width: z.number(), height: z.number() })),
    }),
    archives: z.record(z.union([archive, z.array(archive)])).optional(),
  })
  .passthrough();
const licenseSchema = z.object({
  results: z.array(
    z.object({ uri: z.string().url(), slug: z.string(), label: z.string(), url: z.string().url() }),
  ),
});

/**
 * Public discovery does not create a download URL. Sketchfab requires an authenticated
 * end user for downloads, so this adapter offers the provider's download page instead.
 */
export class SketchfabProvider implements ModelProvider {
  readonly id = 'sketchfab' as const;
  constructor(private readonly http = new ProviderHttpClient()) {}
  private async normalize(raw: z.infer<typeof modelSchema>): Promise<ProviderModel> {
    if (!raw.isDownloadable || !raw.license)
      fail('REMOTE_MODEL_NOT_FOUND', 'Sketchfab: model is not publicly downloadable');
    const licenses = response(
      licenseSchema,
      await this.http.json(this.id, 'https://api.sketchfab.com/v3/licenses'),
    ).results;
    const license = licenses.find((value) => value.uri.endsWith('/' + raw.license!.uid));
    if (!license) fail('UNSUPPORTED_LICENSE', 'Sketchfab: license metadata is unavailable');
    const preview =
      raw.thumbnails.images
        .filter((image) => image.width >= 256)
        .sort((a, b) => a.width - b.width)[0] ?? raw.thumbnails.images.at(-1);
    if (preview) providerUrl(this.id, preview.url, 'preview');
    const source = new URL(raw.viewerUrl);
    if (source.protocol !== 'https:' || source.hostname !== 'sketchfab.com')
      fail('INVALID_PROVIDER_RESPONSE', 'Sketchfab: invalid source page');
    const downloadOptions: ProviderDownloadSummary[] = [];
    for (const [format, variants] of Object.entries(raw.archives ?? {}))
      for (const [index, variant] of (Array.isArray(variants) ? variants : [variants]).entries())
        downloadOptions.push({
          id: format + '-' + index,
          format,
          resolution: variant.textureMaxResolution
            ? String(variant.textureMaxResolution)
            : 'original',
          sizeBytes: variant.size ?? undefined,
        });
    return {
      provider: this.id,
      remoteId: raw.uid,
      name: raw.name,
      description: raw.description,
      tags: raw.tags.map((t) => t.name),
      categories: raw.categories.map((c) => c.name),
      sourceUrl: raw.viewerUrl,
      previewUrl: preview?.url,
      author: raw.user?.displayName ?? raw.user?.username,
      publishedAt: raw.publishedAt,
      license:
        license.slug === 'cc0'
          ? { ...cc0 }
          : {
              id: license.slug,
              name: license.label,
              url: license.url,
              attributionRequired: license.slug.startsWith('by'),
            },
      statistics: { polygonCount: raw.faceCount, vertexCount: raw.vertexCount },
      downloadOptions,
    };
  }
  async search(input: ProviderSearchQuery = {}) {
    const query = response(
      z
        .object({
          text: z.string().max(1000).optional(),
          tags: z.array(z.string()).optional(),
          categories: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(500).default(20),
          cursor: z.string().max(2048).optional(),
        })
        .strict(),
      input,
    );
    const params = new URLSearchParams({
      type: 'models',
      downloadable: 'true',
      count: String(Math.min(24, query.limit)),
      archives_flavours: 'true',
    });
    if (query.text) params.set('q', query.text);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.tags?.length) params.set('tags', query.tags.join(','));
    if (query.categories?.length) params.set('categories', query.categories.join(','));
    const result = response(
      z.object({
        results: z.array(modelSchema),
        cursors: z.object({ next: z.string().nullable() }).optional(),
      }),
      await this.http.json(this.id, 'https://api.sketchfab.com/v3/search?' + params),
    );
    const items = [];
    for (const model of result.results) {
      if (!model.isDownloadable || model.isAgeRestricted || !model.license) continue;
      items.push(await this.normalize(model));
    }
    return { items, nextCursor: result.cursors?.next ?? undefined };
  }
  async getModel(id: string) {
    const remote = response(uid, id);
    return this.normalize(
      response(
        modelSchema,
        await this.http.json(this.id, 'https://api.sketchfab.com/v3/models/' + remote),
      ),
    );
  }
  async getDownloads(_id: string): Promise<ProviderDownload[]> {
    fail(
      'DOWNLOAD_OPTION_NOT_FOUND',
      'Sketchfab downloads require user authentication. Open the model on Sketchfab to download it.',
    );
  }
}
