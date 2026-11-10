import { ModelsError } from '../domain/ModelsError.js';
import { z } from 'zod';
import type { ServerModelsClient } from './ServerModelsClient.js';
import { encodeModelFilePath } from './modelFileUrls.js';
import { readSceneAssetBytes, sceneAssetHash } from './readSceneAssetBytes.js';
import type { SceneGeometryFile, SceneGeometryReference } from './SceneGeometryReference.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const referenceSchema = z
  .object({
    namespace: z.string(),
    kind: z.literal('geometry'),
    id: z.string().max(2048),
    revision: hash,
    variant: z.string().min(1).max(2048),
    sha256: hash,
  })
  .strict();
const fileSchema = z.object({
  path: z.string(),
  sha256: hash,
  bytes: z.number().int().nonnegative(),
});
const representationSchema = z.object({
  modelId: z.string().uuid(),
  format: z.literal('xgfstream'),
  entrypoint: z.string(),
  files: z.array(fileSchema).max(100000),
});
const indexSchema = z.object({
  format: z.literal('XGFStreamingIndex'),
  indexVersion: z.enum(['1.0.0', '1.1.0', '1.2.0']),
  chunks: z
    .array(
      z.object({
        role: z.string(),
        uri: z.string().optional(),
        assets: z.object({ geometries: z.array(z.string().min(1).max(1024)).max(10000) }),
      }),
    )
    .max(10000),
  streams: z.array(z.unknown()).optional(),
});

/**
 * Uses the conversion cache's existing XGF library shards as geometry sources.
 * This is a read-only adapter, not a second geometry database or decoded cache.
 * A changed conversion hash requires a new reference. Deleted models stay deleted.
 */
export class ServerModelAssets {

  /**
   * Stable namespace derived from the verified Models library UUID.
   */
  readonly namespace: string;

  /**
   * Creates a geometry adapter for a verified client. Applications normally use ServerModelsClient.open(...).sceneAssets.
   *
   * @param client - Connected Models client.
   * @param libraryId - Verified library UUID.
   */
  constructor(
    private readonly client: ServerModelsClient,
    libraryId: string,
  ) {
    this.namespace = 'urn:xeokit:models:' + libraryId;
  }
  private parse(reference: SceneGeometryReference): {
    reference: SceneGeometryReference;
    modelId: string;
    geometryId: string;
  } {
    const value = referenceSchema.parse(reference);
    if (value.namespace !== this.namespace || value.sha256 !== value.revision)
      throw new Error('Geometry reference belongs to another library or revision');
    let identity: unknown;
    try {
      identity = JSON.parse(value.id);
    } catch {
      throw new Error('Invalid geometry reference identity');
    }
    const [modelId, geometryId] = z
      .tuple([z.string().uuid(), z.string().min(1).max(1024)])
      .parse(identity);
    if (JSON.stringify([modelId, geometryId]) !== value.id)
      throw new Error('Non-canonical geometry identity');
    encodeModelFilePath(value.variant);
    return { reference: value, modelId, geometryId };
  }

  /**
   * Discovers one bounded model package, never the entire remote library.
   * Stream generation is on demand and may prepare a conversion on the server.
   */
  async references(
    modelId: string,
    options: {

      /**
       * Cancels format preparation and catalog reads.
       */
      signal?: AbortSignal;

      /**
       * Maximum geometry references to discover. Defaults to 10,000; at most 100,000.
       */
      maxReferences?: number;
    } = {},
  ): Promise<SceneGeometryReference[]> {
    try {
      return await this.referencesChecked(modelId, options);
    } catch (cause) {
      if (cause instanceof ModelsError) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ModelsError('INVALID_MODEL', 'Scene assets: ' + message, { cause });
    }
  }

  private async referencesChecked(
    modelId: string,
    options: {

      /**
       * Cancels format preparation and catalog reads.
       */
      signal?: AbortSignal;

      /**
       * Maximum geometry references to discover. Defaults to 10,000; at most 100,000.
       */
      maxReferences?: number;
    } = {},
  ): Promise<SceneGeometryReference[]> {
    z.string().uuid().parse(modelId);
    const max = options.maxReferences ?? 10000;
    if (!Number.isSafeInteger(max) || max < 1 || max > 100000)
      throw new Error('Invalid geometry discovery limit');
    const format = representationSchema.parse(
      await this.client.getFormat(modelId, 'xgfstream', options.signal),
    );
    if (format.modelId !== modelId) throw new Error('Geometry catalog returned another model');
    // The compact runtime index omits geometry IDs. The conversion publishes a
    // readable index alongside it specifically for inspection and tooling.
    const catalogPath = format.entrypoint.endsWith('index.runtime.json')
      ? format.entrypoint.slice(0, -'index.runtime.json'.length) + 'index.json'
      : format.entrypoint;
    const entry = format.files.find((file) => file.path === catalogPath);
    if (!entry) throw new Error('Geometry catalog has no index');
    const bytes = await readSceneAssetBytes(
      this.client.formatFileUrl(modelId, 'xgfstream', entry.path),
      16 * 1024 * 1024,
      options.signal,
    );
    if ((await sceneAssetHash(bytes)) !== entry.sha256)
      throw new Error('Geometry catalog hash mismatch');
    const index = indexSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (index.streams?.length)
      throw new Error(
        'Geometry discovery requires one stream package; choose a child model explicitly',
      );
    const directory = entry.path.includes('/')
      ? entry.path.slice(0, entry.path.lastIndexOf('/') + 1)
      : '';
    const files = new Map(format.files.map((file) => [file.path, file]));
    const result: SceneGeometryReference[] = [],
      seen = new Set<string>();
    for (const chunk of index.chunks) {
      if (!chunk.assets.geometries.length) continue;
      if (!chunk.uri) throw new Error('Geometry shard has no package path');
      encodeModelFilePath(chunk.uri);
      const path = directory + chunk.uri,
        file = files.get(path);
      if (!file) throw new Error('Geometry shard is missing from the conversion');
      for (const id of chunk.assets.geometries) {
        if (seen.has(id)) throw new Error('Geometry catalog contains duplicate definitions');
        seen.add(id);
        if (result.length >= max) throw new Error('Geometry discovery limit exceeded');
        result.push({
          namespace: this.namespace,
          kind: 'geometry',
          id: JSON.stringify([modelId, id]),
          revision: file.sha256,
          sha256: file.sha256,
          variant: path,
        });
      }
    }
    return result;
  }

  /**
   * Download each selected shard once per batch and verify it before decoding.
   * The SDK's readXGFGeometryAssets reads these definitions without a hidden model.
   */
  async resolve(
    references: readonly SceneGeometryReference[],
    options: {

      /**
       * Cancels shard downloads.
       */
      signal?: AbortSignal;

      /**
       * Combined encoded byte limit for this batch. Defaults to 256 MiB.
       */
      maxBytes?: number;
    } = {},
  ): Promise<SceneGeometryFile[]> {
    try {
      return await this.resolveChecked(references, options);
    } catch (cause) {
      if (cause instanceof ModelsError) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new ModelsError('INVALID_MODEL', 'Scene assets: ' + message, { cause });
    }
  }

  private async resolveChecked(
    references: readonly SceneGeometryReference[],
    options: {

      /**
       * Cancels shard downloads.
       */
      signal?: AbortSignal;

      /**
       * Combined encoded byte limit for this batch. Defaults to 256 MiB.
       */
      maxBytes?: number;
    } = {},
  ): Promise<SceneGeometryFile[]> {
    if (references.length > 10000) throw new Error('Geometry request limit exceeded');
    const groups = new Map<string, ReturnType<ServerModelAssets['parse']>[]>();
    for (const reference of references) {
      const item = this.parse(reference),
        key = JSON.stringify([item.modelId, item.reference.variant, item.reference.revision]);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    }
    let remaining = options.maxBytes ?? 256 * 1024 * 1024;
    if (!Number.isSafeInteger(remaining) || remaining < 1)
      throw new ModelsError('INVALID_MODEL', 'Invalid scene asset byte limit');
    const results: SceneGeometryFile[] = [];
    for (const group of groups.values()) {
      options.signal?.throwIfAborted();
      const first = group[0];
      const bytes = await readSceneAssetBytes(
        this.client.formatFileUrl(first.modelId, 'xgfstream', first.reference.variant),
        remaining,
        options.signal,
      );
      if ((await sceneAssetHash(bytes)) !== first.reference.sha256)
        throw new Error('Geometry revision is unavailable or its hash does not match');
      remaining -= bytes.byteLength;
      results.push({
        references: group.map((item) => item.reference),
        geometryIds: group.map((item) => item.geometryId),
        bytes,
      });
    }
    return results;
  }
}
