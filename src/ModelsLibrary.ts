import { ModelPropertyStore } from './properties/ModelPropertyStore.js';
import {
  propertyInput,
  propertyModeSchema,
  propertySetQuerySchema,
  objectPropertiesQuerySchema,
  propertyObjectQuerySchema,
} from './properties/schema.js';
import type {
  PropertySetMode,
  PropertySetQuery,
  ObjectPropertiesQuery,
  PropertyObjectQuery,
} from './properties/types.js';
import type { ProcessingSettings } from './processing/types.js';
import { ModelConversionService } from './conversion/ModelConversionService.js';
import type { ConversionFormat } from './conversion/types.js';
import type { ModelRepresentationFormat } from './conversion/ModelFormats.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fail, wrap } from './domain/ModelsError.js';
import type {
  OpenLibraryOptions,
  ModelQuery,
  ImportOptions,
  Metadata,
  Manifest,
} from './domain/types.js';
import { parse, tagsSchema } from './domain/schema.js';
import { Database } from './storage/Database.js';
import { ModelRepository } from './storage/ModelRepository.js';
import { AssetStore } from './storage/AssetStore.js';
import { Maintenance } from './storage/Maintenance.js';
import { Importer } from './importing/Importer.js';
import { extractBundle, writeBundle } from './importing/Bundle.js';
import { relativeFile } from './storage/paths.js';
import {
  ModelAcquisitionService,
  type AcquisitionServiceOptions,
} from './acquisition/ModelAcquisitionService.js';

/**
 * Public operations share one catalog and transaction boundary. Model files are
 * immutable; deleting a catalog record never deletes a shared binary.
 */
export class ModelsLibrary {
  private readonly properties: ModelPropertyStore;
  private readonly repository: ModelRepository;
  private readonly assets: AssetStore;
  private readonly importer: Importer;
  private readonly conversions: ModelConversionService;
  private readonly pending = new Set<Promise<unknown>>();
  private closeTask?: Promise<void>;
  private closed = false;
  private closing = false;
  private acquisitionService?: ModelAcquisitionService;
  private constructor(
    private readonly db: Database,
    options: OpenLibraryOptions,
  ) {
    this.repository = new ModelRepository(db);
    this.properties = new ModelPropertyStore(db);

    this.assets = new AssetStore(db);
    this.conversions = new ModelConversionService(
      db,
      this.repository,
      this.assets,
      options.xeoIFC,
      options.processingWorker,
      this.properties,
    );
    this.importer = new Importer(
      this.repository,
      this.assets,
      async (model, mode) => await this.conversions.imported(model, mode),
    );
  }
  static async open(options: OpenLibraryOptions) {
    let db: Database | undefined;
    try {
      db = await Database.open(path.resolve(options.root), options.create, options.database);
      return new ModelsLibrary(db, options);
    } catch (e) {
      await db?.close();
      throw wrap(e, 'Open models library');
    }
  }
  private async use<T>(work: () => T | Promise<T>): Promise<T> {
    if (this.closed || this.closing) fail('LIBRARY_CLOSED', 'Models library is closed');
    const task = Promise.resolve().then(work);
    this.pending.add(task);
    try {
      return await task;
    } catch (error) {
      throw wrap(error, 'Models library');
    } finally {
      this.pending.delete(task);
    }
  }

  /**
   * Finish operations already accepted before closing the PostgreSQL pool.
   */
  async close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    return (this.closeTask = (async () => {
      await this.conversions.close();
      await Promise.allSettled([...this.pending]);
      await this.acquisitionService?.close();
      await this.db.close();
      this.closed = true;
    })());
  }
  async acquisition(options: AcquisitionServiceOptions = {}) {
    return this.use(() => {
      this.acquisitionService ??= new ModelAcquisitionService(
        this.db,
        async (manifest, before, after) =>
          (await this.importer.manifest(manifest, false, before, after)).model!,
        async (id) => await this.repository.get(id),
        async () => {
          if (this.closed) fail('LIBRARY_CLOSED', 'Models library is closed');
        },
        options,
      );
      return this.acquisitionService.initialize();
    });
  }
  async create(input: { metadata: unknown }) {
    return this.use(
      async () =>
        await this.db.transaction(async () => {
          const model = await this.repository.create(input.metadata);
          await this.properties.initialize(
            model.id,
            (await this.conversions.settings()).propertySetMode ?? 'embedded',
          );
          return model;
        }),
    );
  }
  async get(id: string) {
    return this.use(async () => await this.repository.get(id));
  }
  async list(query: ModelQuery = {}) {
    return this.use(async () => (await this.repository.list(query)).items);
  }
  async search(query: ModelQuery | string = {}) {
    return this.list(typeof query === 'string' ? { text: query } : query);
  }
  async page(query: ModelQuery = {}) {
    return this.use(async () => await this.repository.list(query));
  }
  async update(id: string, patch: { metadata: Partial<Metadata> }) {
    return this.use(async () => {
      if (Object.keys(patch).some((k) => k !== 'metadata'))
        fail('INVALID_MODEL', 'Update model: only metadata may change');
      return await this.db.transaction(
        async () => await this.repository.update(id, patch.metadata),
      );
    });
  }
  async delete(id: string) {
    return this.use(async () => {
      await this.db.transaction(async () => {
        await this.db.lock('model:' + id);
        await this.repository.require(id);
        await this.conversions.remove(id);
        await this.repository.delete(id);
      });
      // A later startup also removes this directory if deletion is interrupted.
      await this.properties.remove(id);
    });
  }
  async listTags() {
    return this.use(async () => await this.repository.listTags());
  }
  async addTags(id: string, tags: string[]) {
    return this.use(
      async () =>
        await this.db.transaction(async () => {
          await this.db.lock('model:' + id);
          const m = await this.repository.require(id);
          return await this.repository.update(id, {
            tags: [...m.metadata.tags, ...parse(tagsSchema, tags)],
          });
        }),
    );
  }
  async removeTags(id: string, tags: string[]) {
    return this.use(
      async () =>
        await this.db.transaction(async () => {
          await this.db.lock('model:' + id);
          const remove = parse(tagsSchema, tags),
            m = await this.repository.require(id);
          return await this.repository.update(id, {
            tags: m.metadata.tags.filter((t) => !remove.includes(t)),
          });
        }),
    );
  }
  async importFile(input: ImportOptions) {
    return this.use(async () => {
      if (input.propertySetMode !== undefined)
        propertyInput(propertyModeSchema, input.propertySetMode);
      return await this.importer.file(input);
    });
  }
  async importDirectory(input: ImportOptions & { entrypoint: string }) {
    return this.importFile({
      ...input,
      path: relativeFile(path.resolve(input.path), input.entrypoint),
    });
  }
  async importManifest(input: { manifestPath: string; dryRun?: boolean }) {
    return this.use(() => this.importer.manifest(path.resolve(input.manifestPath), input.dryRun));
  }
  async importBundle(input: { path: string; dryRun?: boolean }) {
    return this.use(async () => {
      const root = await extractBundle(input.path);
      try {
        return await this.importer.manifest(path.join(root, 'manifest.json'), input.dryRun);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
  async getAsset(id: string) {
    return this.use(async () => {
      this.assets.path(id);
      const r = await this.db.one(
        'SELECT id,bytes,mime,original_filename "originalFilename",imported_at "importedAt" FROM assets WHERE id=$1',
        [id],
      );
      return r ?? null;
    });
  }
  async resolveAsset(id: string) {
    return this.use(async () => {
      if (!(await this.db.one('SELECT id FROM assets WHERE id=$1', [id])))
        fail('ASSET_NOT_FOUND', 'Asset does not exist');
      const file = this.assets.path(id);
      if (!fs.existsSync(file)) fail('ASSET_NOT_FOUND', 'Asset binary is missing');
      return file;
    });
  }
  async resolveFile(id: string, name: string) {
    return this.use(async () => {
      const model = await this.repository.require(id);
      relativeFile(this.db.root, name);
      const file = model.files.find((f) => f.path === name);
      if (!file) fail('ASSET_NOT_FOUND', 'Model package does not contain ' + name);
      return { path: this.assets.path(file.assetId), mime: file.mime, bytes: file.bytes };
    });
  }
  async exportModel(input: { modelId: string; outputPath: string }) {
    return this.use(async () => {
      const model = await this.repository.require(input.modelId);
      if (!model.entrypoint) fail('INVALID_MODEL', 'Export model: no entrypoint');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-export-'));
      try {
        const manifest: Manifest = {
          schemaVersion: 1,
          metadata: model.metadata,
          originalId: model.id,
          entrypoint: model.entrypoint,
          files: model.files.map((f) => ({ path: f.path, sha256: f.assetId })),
        };
        fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
        const files = [
          { path: path.join(root, 'manifest.json'), name: 'manifest.json' },
          ...model.files.map((f) => ({ path: this.assets.path(f.assetId), name: f.path })),
        ];
        await writeBundle(input.outputPath, files);
        return { outputPath: path.resolve(input.outputPath) };
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  /**
   * Discover compatible formats. IFC preparation caches its reusable XGF and DataModel.
   */
  async availableFormats(modelId: string) {
    return this.use(async () => await this.conversions.availableFormats(modelId));
  }

  /**
   * Prepare a requested format, reusing its cached files when available.
   */
  async getFormat(modelId: string, format: ModelRepresentationFormat) {
    return this.use(async () => await this.conversions.getFormat(modelId, format));
  }
  async resolveFormatFile(modelId: string, format: ModelRepresentationFormat, name: string) {
    return this.use(async () => await this.conversions.resolveFormatFile(modelId, format, name));
  }
  async downloadFormats(modelId: string) {
    return this.use(async () => await this.conversions.formats(modelId));
  }
  async convertModel(input: { modelId: string; format: ConversionFormat }) {
    return this.use(async () => await this.conversions.convert(input.modelId, input.format));
  }
  async exportConvertedModel(input: {
    modelId: string;
    format: ConversionFormat;
    outputPath: string;
  }) {
    return this.use(
      async () =>
        await this.conversions.export(input.modelId, input.format, path.resolve(input.outputPath)),
    );
  }
  async thumbnailStatus(modelId: string) {
    return this.use(async () => await this.conversions.thumbnailStatus(modelId));
  }
  async resolveThumbnail(modelId: string) {
    return this.use(async () => await this.conversions.resolveThumbnail(modelId));
  }
  async resolveDataModelFile(modelId: string, options: { propertySetMode?: PropertySetMode } = {}) {
    return this.use(
      async () => await this.conversions.resolveDataModelFile(modelId, options.propertySetMode),
    );
  }
  async propertiesInfo(modelId: string) {
    return this.use(async () => await this.properties.info(modelId));
  }
  async configureProperties(modelId: string, options: { mode: PropertySetMode }) {
    return this.use(async () => await this.conversions.configureProperties(modelId, options.mode));
  }
  async getPropertySets(modelId: string, query: PropertySetQuery) {
    return this.use(async () => {
      const input = propertyInput(propertySetQuerySchema, query);
      return (await this.properties.reader(modelId, input.revision)).sets(input);
    });
  }
  async getObjectProperties(modelId: string, query: ObjectPropertiesQuery) {
    return this.use(async () => {
      const input = propertyInput(objectPropertiesQuerySchema, query);
      return (await this.properties.reader(modelId, input.revision)).objects(input);
    });
  }
  async queryPropertyObjects(modelId: string, query: PropertyObjectQuery) {
    return this.use(async () => {
      const input = propertyInput(propertyObjectQuerySchema, query);
      return (await this.properties.reader(modelId, input.revision)).queryObjects(input);
    });
  }
  async processing(modelId?: string) {
    return this.use(async () => await this.conversions.processing(modelId));
  }
  async processingSettings() {
    return this.use(async () => await this.conversions.settings());
  }
  async configureProcessing(patch: Partial<ProcessingSettings>) {
    return this.use(async () => await this.conversions.configure(patch));
  }
  async prepareIFC(modelId: string) {
    return this.use(async () => await this.conversions.scheduleIFC(modelId));
  }
  async cancelConversion(jobId: string) {
    return this.use(async () => await this.conversions.cancelJob(jobId));
  }
  async retryConversion(jobId: string) {
    return this.use(async () => await this.conversions.retryJob(jobId));
  }
  async summary() {
    return this.use(async () => ({
      id: (await this.db.one('SELECT id FROM library_info', []))!.id,
      name: path.basename(this.db.root),
      modelCount: (await this.db.one('SELECT count(*) n FROM models', []))!.n,
      providers: (
        await this.db.all(
          "SELECT DISTINCT (source_json::json->>'provider') provider FROM models WHERE (source_json::json->>'provider') IS NOT NULL ORDER BY provider",
          [],
        )
      ).map((r) => r.provider),
    }));
  }
  async validate() {
    return this.use(async () => await new Maintenance(this.db, this.assets).validate());
  }
  async gc(options: { dryRun?: boolean } = {}) {
    return this.use(
      async () => await new Maintenance(this.db, this.assets).gc(options.dryRun !== false),
    );
  }
}
