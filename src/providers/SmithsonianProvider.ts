import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ProviderHttpClient } from './ProviderHttpClient.js';
import { response, cc0, searchSchema } from './validation.js';
import { providerUrl } from './HostPolicy.js';
import { fail } from '../domain/ModelsError.js';
import type {
  ModelProvider,
  ProviderModel,
  ProviderSearchQuery,
  ProviderDownload,
} from './types.js';
const idSchema = z.string().uuid();
const rowSchema = z.object({
  title: z.string(),
  content: z
    .object({
      uri: z.string().url(),
      model_url: z.string().regex(/^3d_package:[a-f0-9-]{36}$/),
      file_type: z.string(),
      model_type: z.string().optional(),
      quality: z.string().optional(),
      usage: z.string().optional(),
      file_size: z.number().int().nonnegative().optional(),
      gltf_orientation_compliant: z.boolean().optional(),
      draco_compressed: z.boolean().optional(),
    })
    .passthrough(),
});
const pageSchema = z.object({
  rows: z.array(rowSchema).default([]),
  rowCount: z.number().int().nonnegative().default(0),
});
type Row = z.infer<typeof rowSchema>;

/**
 * Smithsonian's public 3D endpoint contains Open Access files. Import complete GLBs;
 * preserve its quality labels instead of inventing texture resolutions or polygon counts.
 */
export class SmithsonianProvider implements ModelProvider {
  readonly id = 'smithsonian' as const;
  constructor(private readonly http = new ProviderHttpClient()) {}
  refresh() {
    this.http.refresh();
  }
  private async page(parameters: Record<string, string>) {
    return response(
      pageSchema,
      await this.http.json(
        this.id,
        'https://3d-api.si.edu/api/v1.0/content/file/search?' + new URLSearchParams(parameters),
      ),
    );
  }
  private normalize(id: string, rows: Row[]): ProviderModel {
    const row = rows.find((row) => row.content.model_url === '3d_package:' + id);
    if (!row) fail('REMOTE_MODEL_NOT_FOUND', 'Smithsonian: model not found');
    const preview = rows.find(
      (row) => row.content.file_type === 'jpg' && row.content.quality === 'Thumb',
    );
    if (preview) providerUrl(this.id, preview.content.uri, 'preview');
    return {
      provider: this.id,
      remoteId: id,
      name: row.title,
      tags: ['smithsonian', 'open-access'],
      categories: [],
      sourceUrl: 'https://3d.si.edu/object/3d/' + id,
      previewUrl: preview?.content.uri,
      license: { ...cc0 },
      metadata: { publisher: 'Smithsonian Institution' },
    };
  }
  private async modelRows(id: string) {
    response(idSchema, id);
    const rows: Row[] = [];
    for (let start = 0; start < 500; start += 100) {
      const page = await this.page({ model_url: id, rows: '100', start: String(start) });
      rows.push(...page.rows);
      if (start + page.rows.length >= page.rowCount || !page.rows.length) return rows;
    }
    fail(
      'INVALID_PROVIDER_RESPONSE',
      'Smithsonian: model manifest exceeds bounded discovery limit',
    );
  }
  async search(input: ProviderSearchQuery = {}) {
    const query = response(searchSchema, input),
      offset = Number(query.cursor ?? 0),
      count = Math.min(500, Math.max(100, query.limit * 10));
    const page = await this.page({
      q: query.text ?? '',
      file_type: 'glb',
      rows: String(count),
      start: String(offset),
    });
    const groups = new Map<string, Row[]>();
    for (const row of page.rows) {
      const id = row.content.model_url.slice(11);
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    const items = [...groups]
      .map(([id, rows]) => this.normalize(id, rows))
      .filter(
        (model) =>
          (query.tags ?? []).every((tag) => model.tags.includes(tag.toLowerCase())) &&
          !query.categories?.length,
      )
      .slice(0, query.limit);
    return {
      items,
      nextCursor:
        offset + page.rows.length < page.rowCount ? String(offset + page.rows.length) : undefined,
    };
  }
  async getModel(id: string) {
    return this.normalize(id, await this.modelRows(id));
  }
  async getPreviewUrl(id: string) {
    return (await this.getModel(id)).previewUrl;
  }
  async getDownloads(id: string): Promise<ProviderDownload[]> {
    const rows = await this.modelRows(id),
      seen = new Set<string>(),
      sets: ProviderDownload[] = [];
    for (const row of rows) {
      const file = row.content;
      if (file.file_type !== 'glb' || file.usage !== 'Download3D' || seen.has(file.uri)) continue;
      seen.add(file.uri);
      const url = providerUrl(this.id, file.uri),
        filename = decodeURIComponent(url.pathname.split('/').at(-1)!);
      const quality = (file.quality ?? 'original').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const suffix = createHash('sha256').update(file.uri).digest('hex').slice(0, 8),
        variant = quality.slice(0, 40) + '-' + suffix;
      sets.push({
        id: variant,
        resolution: variant,
        format: 'glb',
        files: [
          {
            role: 'entrypoint',
            url: url.href,
            filename,
            packagePath: filename,
            sizeBytes: file.file_size,
          },
        ],
        estimatedBytes: file.file_size,
      });
    }
    return sets.sort(
      (a, b) =>
        (a.estimatedBytes ?? Infinity) - (b.estimatedBytes ?? Infinity) || a.id.localeCompare(b.id),
    );
  }
}
