import { z } from 'zod';
import { resolutionPattern, compareResolutions } from '../domain/resolutions.js';
import { fail } from '../domain/ModelsError.js';
import { ProviderHttpClient } from './ProviderHttpClient.js';
import { providerUrl } from './HostPolicy.js';
import { response, remoteIdSchema, searchSchema, cc0 } from './validation.js';
import type {
  ModelProvider,
  ProviderModel,
  ProviderSearchQuery,
  ProviderDownload,
  ProviderDownloadFile,
} from './types.js';
const assetSchema = z
  .object({
    name: z.string().min(1),
    type: z.number().int(),
    tags: z.array(z.string()),
    categories: z.array(z.string()).optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    date_published: z.number().finite().optional(),
    authors: z.record(z.string()).optional(),
    files_hash: z.string().optional(),
    dimensions: z.array(z.number()).optional(),
    polycount: z.number().int().nonnegative().optional(),
    max_resolution: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    attributes: z
      .object({ lods: z.boolean().optional(), rigged: z.boolean().optional() })
      .passthrough()
      .optional(),
    thumbnail_url: z.string().url().optional(),
  })
  .passthrough();
const fileSchema = z
  .object({
    url: z.string().url(),
    size: z.number().int().nonnegative(),
    md5: z
      .string()
      .regex(/^[a-f0-9]{32}$/i)
      .optional(),
  })
  .passthrough();
const modelFileSchema = fileSchema.extend({ include: z.record(fileSchema).optional() });
const filesSchema = z.record(z.record(z.record(modelFileSchema)));

/**
 * Poly Haven has a catalog dictionary, not a server-side page stream.
 */
export class PolyHavenProvider implements ModelProvider {
  readonly id = 'polyhaven' as const;
  constructor(private readonly http = new ProviderHttpClient()) {}
  refresh() {
    this.http.refresh();
  }
  private normalize(id: string, asset: z.infer<typeof assetSchema>): ProviderModel {
    if (asset.type !== 2) fail('REMOTE_MODEL_NOT_FOUND', 'Poly Haven: asset is not a model');
    return {
      provider: this.id,
      remoteId: id,
      name: asset.name,
      description: asset.description,
      tags: asset.tags,
      categories: [
        ...new Set([...(asset.categories ?? []), ...(asset.category ? [asset.category] : [])]),
      ],
      sourceUrl: `https://polyhaven.com/a/${id}`,
      previewUrl: asset.thumbnail_url,
      license: { ...cc0 },
      statistics: {
        polygonCount: asset.polycount,
        maxTextureResolution: asset.max_resolution,
        hasLods: asset.attributes?.lods,
        rigged: asset.attributes?.rigged,
      },
      author: Object.keys(asset.authors ?? {}).join(', ') || undefined,
      publishedAt: asset.date_published
        ? new Date(asset.date_published * 1000).toISOString()
        : undefined,
      metadata: { filesHash: asset.files_hash, dimensions: asset.dimensions },
    };
  }
  async search(input: ProviderSearchQuery = {}) {
    const query = response(searchSchema, input);
    const raw = response(
      z.record(assetSchema),
      await this.http.json(this.id, 'https://api.polyhaven.com/assets?type=models'),
    );
    const words = (query.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const all = Object.entries(raw)
      .filter(
        ([, a]) => a.type === 2 && (!a.date_published || a.date_published * 1000 <= Date.now()),
      )
      .map(([id, a]) => this.normalize(response(remoteIdSchema, id), a))
      .filter(
        (m) =>
          words.every((w) =>
            [m.remoteId, m.name, ...m.tags, ...m.categories!].join(' ').toLowerCase().includes(w),
          ) &&
          (query.tags ?? []).every((t) =>
            m.tags.some((v) => v.toLowerCase() === t.toLowerCase()),
          ) &&
          (query.categories ?? []).every((t) =>
            m.categories!.some(
              (v) =>
                v.toLowerCase() === t.toLowerCase() ||
                v.toLowerCase().startsWith(t.toLowerCase() + '/'),
            ),
          ),
      )
      .sort((a, b) => (a.remoteId < b.remoteId ? -1 : 1));
    const offset = Number(query.cursor ?? 0),
      end = offset + query.limit;
    return {
      items: all.slice(offset, end),
      total: all.length,
      nextCursor: end < all.length ? String(end) : undefined,
    };
  }
  async getModel(remoteId: string) {
    const id = response(remoteIdSchema, remoteId);
    return this.normalize(
      id,
      response(assetSchema, await this.http.json(this.id, `https://api.polyhaven.com/info/${id}`)),
    );
  }
  async getDownloads(remoteId: string): Promise<ProviderDownload[]> {
    const id = response(remoteIdSchema, remoteId),
      raw = response(
        filesSchema,
        await this.http.json(this.id, `https://api.polyhaven.com/files/${id}`),
      );
    const sets: ProviderDownload[] = [];
    for (const format of ['gltf', 'glb', 'fbx', 'blend'])
      for (const [size, formats] of Object.entries(raw[format] ?? {})) {
        const file = formats[format];
        if (!file || !resolutionPattern.test(size)) continue;
        const entryUrl = providerUrl(this.id, file.url),
          entryName = decodeURIComponent(entryUrl.pathname.split('/').at(-1)!);
        const source = (
          f: z.infer<typeof fileSchema>,
          role: string,
          packagePath: string,
        ): ProviderDownloadFile => {
          if (
            !/^[\w. /-]+$/.test(packagePath) ||
            packagePath.startsWith('/') ||
            packagePath.split('/').some((p) => !p || p === '.' || p === '..')
          )
            fail('INVALID_PROVIDER_RESPONSE', 'Poly Haven: unsafe package path');
          const url = providerUrl(this.id, f.url);
          return {
            role,
            url: url.href,
            filename: packagePath.split('/').at(-1)!,
            packagePath,
            sizeBytes: f.size,
            checksum: f.md5 ? { algorithm: 'md5', value: f.md5.toLowerCase() } : undefined,
          };
        };
        const files = [
          source(file, 'entrypoint', entryName),
          ...Object.entries(file.include ?? {})
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, f]) => source(f, 'resource', name)),
        ];
        if (new Set(files.map((f) => f.packagePath?.toLowerCase())).size !== files.length)
          fail('INVALID_PROVIDER_RESPONSE', 'Poly Haven: duplicate package path');
        sets.push({
          id: `${size}-${format}`,
          resolution: size.toLowerCase(),
          format,
          files,
          estimatedBytes: files.reduce((n, f) => n + f.sizeBytes!, 0),
        });
      }
    return sets.sort(
      (a, b) => compareResolutions(a.resolution, b.resolution) || a.id.localeCompare(b.id),
    );
  }
}
