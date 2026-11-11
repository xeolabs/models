import { PropertyDocumentExport } from './PropertyDocumentExport.js';
import { IFCPreparationReuse } from './IFCPreparationReuse.js';
import { ModelPropertyStore } from '../properties/ModelPropertyStore.js';
import type { PropertySetMode } from '../properties/types.js';
import { propertyInput, propertyModeSchema } from '../properties/schema.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { XeoIFCRuntime, type XeoIFCOptions } from './XeoIFCRuntime.js';
import { Database } from '../storage/Database.js';
import { ModelRepository } from '../storage/ModelRepository.js';
import { AssetStore, mime } from '../storage/AssetStore.js';
import { noLinks, relativeFile } from '../storage/paths.js';
import { ModelsError, fail } from '../domain/ModelsError.js';
import { writeBundle } from '../importing/Bundle.js';
import { CONVERSION_LIMITS } from './limits.js';
import { conversionEntrypoint } from './entrypoint.js';
import type { ModelRecord } from '../domain/types.js';
import { ConversionCache, optionsSchema, conversionResultSchema } from './ConversionCache.js';
import {
  ConversionRunner,
  converterRevision,
  previousConverterRevision,
} from './ConversionRunner.js';
import { ConversionThumbnailStore } from './ConversionThumbnailStore.js';
import { ConversionPublisher } from './ConversionPublisher.js';
import { stageConversion } from './ConversionStaging.js';
import { copyConversionFile } from './ConversionFiles.js';
import { ProcessingQueue } from '../processing/ProcessingQueue.js';
import { ProcessingRepository } from '../processing/ProcessingRepository.js';
import type { ProcessingJob, ProcessingProgress, ProcessingSettings } from '../processing/types.js';
import {
  conversionFormats,
  type ConversionFormat,
  type ConvertedModel,
  type ModelDownloadFormats,
} from './types.js';
import type {
  AvailableModelFormats,
  ModelFormatRepresentation,
  ModelRepresentationFormat,
} from './ModelFormats.js';
const readable = new Set([
  'gltf',
  'glb',
  'xgf',
  'ifc',
  'obj',
  'ply',
  'stl',
  'fbx',
  'cityjson',
  'e57',
  'las',
  'laz',
  'xkt',
]);

/**
 * IFC enters the SDK once: its XGF and DataModel become the reusable source for
 * later exports. Every expensive operation shares the durable processing queue.
 */
export class ModelConversionService {
  private readonly cache: ConversionCache;
  private readonly runner: ConversionRunner;
  private readonly publisher: ConversionPublisher;
  private readonly thumbnails: ConversionThumbnailStore;
  private readonly xeoIFC: XeoIFCRuntime;
  private readonly queue: ProcessingQueue;
  constructor(
    private readonly db: Database,
    private readonly models: ModelRepository,
    private readonly assets: AssetStore,
    xeoIFC?: XeoIFCOptions,
    processingWorker = false,
    private readonly properties = new ModelPropertyStore(db),
  ) {
    this.cache = new ConversionCache(db.root);
    this.thumbnails = new ConversionThumbnailStore(this.cache);
    this.xeoIFC = new XeoIFCRuntime(xeoIFC);
    const jobs = new ProcessingRepository(db);
    this.runner = new ConversionRunner(this.xeoIFC, async () => await jobs.settings());
    this.publisher = new ConversionPublisher(db, assets, this.cache);
    this.queue = new ProcessingQueue(
      jobs,
      async (job, signal, report) => await this.work(job, signal, report),
      processingWorker,
    );
  }
  private async fingerprint(
    model: ModelRecord,
    mode: PropertySetMode | undefined = undefined,
    revision = converterRevision,
    legacy = false,
  ) {
    mode ??= (await this.properties.info(model.id)).mode;
    return createHash('sha256')
      .update(
        JSON.stringify({
          pipeline: 2,
          converterRevision: revision,
          ...(legacy ? {} : { propertySetMode: mode }),
          xeoIFC: model.format === 'ifc' ? this.xeoIFC.resolve().revision : undefined,
          attribution: model.metadata.source,
          entrypoint: model.entrypoint,
          format: model.format,
          files: model.files
            .map((file) => [file.path, file.assetId])
            .sort((a, b) => a[0].localeCompare(b[0])),
        }),
      )
      .digest('hex');
  }
  private async current(id: string, fingerprint: string) {
    if ((await this.fingerprint(await this.models.require(id))) !== fingerprint)
      fail('CONFLICT', 'Convert model: source files changed');
  }
  private checked<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
    const result = schema.safeParse(value);
    if (!result.success)
      fail('CONVERSION_FAILED', 'Convert model: the SDK worker returned an invalid result');
    return result.data;
  }

  /**
   * Called inside the import transaction, after all original files are installed.
   * Scheduling never loads the IFC or requires an engine during the import itself.
   */
  async imported(model: ModelRecord, mode?: PropertySetMode) {
    await this.properties.initialize(
      model.id,
      mode ?? (await this.settings()).propertySetMode ?? 'embedded',
    );
    if (model.format === 'ifc' && (await this.queue.repository.settings()).automaticIFC)
      await this.queue.repository.enqueue(model.id, 'prepare-ifc', 'xgf', 'automatic');
  }
  async configureProperties(id: string, mode: PropertySetMode) {
    propertyInput(propertyModeSchema, mode);
    if ((await this.models.require(id)).format !== 'ifc')
      fail('UNSUPPORTED_FORMAT', 'Properties: storage selection currently requires IFC');
    return await this.db.transaction(async () => {
      if (
        (await this.queue.repository.list(id)).some((job) =>
          ['queued', 'running', 'cancelling'].includes(job.status),
        )
      )
        fail('JOB_CONFLICT', "Properties: wait for or cancel this model's processing job first");
      await this.properties.setMode(id, mode);
      const job = await this.queue.repository.enqueue(id, 'prepare-ifc', 'xgf', 'requested');
      return { properties: await this.properties.info(id), job };
    });
  }
  async settings() {
    return await this.queue.repository.settings();
  }
  async configure(patch: Partial<ProcessingSettings>) {
    return await this.queue.repository.configure(patch);
  }
  async processing(modelId?: string) {
    return await this.queue.overview(modelId);
  }
  async scheduleIFC(id: string) {
    if ((await this.models.require(id)).format !== 'ifc')
      fail('UNSUPPORTED_FORMAT', 'Prepare IFC: expected an IFC model');
    return await this.queue.enqueue(id, 'prepare-ifc', 'xgf');
  }
  async cancelJob(id: string) {
    await this.queue.cancel(id);
  }
  async retryJob(id: string) {
    const job =
      (await this.queue.repository.get(id)) ??
      fail('JOB_NOT_FOUND', 'Retry conversion: job does not exist');
    if (!['failed', 'interrupted', 'cancelled'].includes(job.status))
      fail('JOB_CONFLICT', 'Retry conversion: job is not stopped');
    return await this.queue.enqueue(job.modelId, job.kind, job.format);
  }
  async thumbnailStatus(id: string) {
    const model = await this.models.require(id);
    if (model.format !== 'ifc') return { ready: false };
    let fingerprint: string;
    try {
      fingerprint = await this.fingerprint(model);
    } catch {
      return { ready: false };
    }
    const preview = this.thumbnails.info(id, fingerprint);
    // Preparation publishes geometry before its preview. Cards wait for that job
    // instead of queuing a second thumbnail while the first is still being saved.
    if (
      !preview &&
      (await this.queue.repository.list(id)).some(
        (job) =>
          job.kind === 'prepare-ifc' && ['queued', 'running', 'cancelling'].includes(job.status),
      )
    )
      return { ready: false };
    if (!preview && !this.cache.has(id, fingerprint, 'xgf')) return { ready: false };
    return {
      ready: !!preview,
      url:
        '/api/models/' +
        encodeURIComponent(id) +
        '/thumbnail?revision=' +
        fingerprint +
        '-' +
        (preview?.sha256 ?? 'pending'),
    };
  }
  async resolveThumbnail(id: string) {
    const model = await this.models.require(id),
      fingerprint = await this.fingerprint(model);
    if (model.format !== 'ifc') fail('UNSUPPORTED_FORMAT', 'Thumbnail: expected an IFC model');
    let preview = await this.thumbnails.resolve(id, fingerprint);
    if (preview) return preview;
    // A library card must not trigger a whole-library IFC preparation when automatic mode is off.
    if (!this.cache.has(id, fingerprint, 'xgf'))
      fail('ASSET_NOT_FOUND', 'Thumbnail: prepare the IFC first');
    await this.queue.wait((await this.queue.enqueue(id, 'thumbnail', 'xgf')).id);
    preview = await this.thumbnails.resolve(id, fingerprint);
    if (!preview) fail('CONVERSION_FAILED', 'Thumbnail could not be verified');
    return preview;
  }
  async close() {
    await this.queue.close();
  }
  async remove(id: string) {
    await this.queue.cancelModel(id);
    this.cache.remove(id);
  }

  private async prepareIFC(id: string): Promise<ConvertedModel> {
    const fingerprint = await this.fingerprint(await this.models.require(id));
    const cached = await this.cache.get(id, fingerprint, 'xgf');
    if (
      cached &&
      this.cache.readOptions(id, fingerprint) &&
      ((await this.properties.info(id)).mode !== 'external' ||
        (await this.properties.info(id)).revision === fingerprint)
    )
      return cached;
    const job = await this.queue.enqueue(id, 'prepare-ifc', 'xgf');
    await this.queue.wait(job.id);
    const result = await this.cache.get(id, fingerprint, 'xgf');
    if (
      !result ||
      ((await this.properties.info(id)).mode === 'external' &&
        (!(await this.properties.info(id)).ready ||
          (await this.properties.info(id)).revision !== fingerprint))
    )
      fail('CONVERSION_FAILED', 'Prepare IFC: geometry or property database could not be verified');
    return { ...result, cached: false };
  }
  async formats(id: string): Promise<ModelDownloadFormats> {
    const model = await this.models.require(id);
    if (!model.format || !model.entrypoint || !readable.has(model.format))
      return {
        modelId: id,
        formats: [],
        message:
          'The SDK has no configured server-side loader for this source format. Download the original package.',
      };
    const fingerprint = await this.fingerprint(model);
    if (model.format === 'ifc') await this.prepareIFC(id);
    let options = this.cache.readOptions(id, fingerprint);
    if (!options) {
      await this.queue.wait((await this.queue.enqueue(id, 'inspect', '')).id);
      options = this.cache.readOptions(id, fingerprint);
    }
    if (!options) fail('CONVERSION_FAILED', 'Inspect model: format options are missing');
    const formats = [];
    for (const option of options.formats) {
      const cached = await this.cache.get(id, fingerprint, option.format);
      formats.push({
        ...option,
        cached: !!cached,
        ...(cached ? { bytes: cached.files.reduce((n, file) => n + file.bytes, 0) } : {}),
      });
    }
    return { modelId: id, formats };
  }
  async availableFormats(id: string): Promise<AvailableModelFormats> {
    const model = await this.models.require(id);
    const result: AvailableModelFormats = { modelId: id, formats: [], warnings: [] };
    if (model.format && model.entrypoint)
      result.formats.push({
        format: model.format,
        entrypoint: model.entrypoint,
        source: 'original',
        cached: true,
        bytes: model.files.reduce((sum, file) => sum + file.bytes, 0),
        warnings: model.warnings,
      });
    try {
      const converted = await this.formats(id);
      result.formats.push(
        ...converted.formats.map((option) => ({
          ...option,
          entrypoint: conversionEntrypoint(option.format),
          source: 'converted' as const,
        })),
      );
      if (converted.message) result.warnings.push(converted.message);
    } catch (error) {
      if (
        !(error instanceof ModelsError) ||
        !['CONVERSION_FAILED', 'CONVERSION_TIMEOUT', 'CONVERSION_CANCELLED'].includes(error.code)
      )
        throw error;
      result.warnings.push(error.message);
    }
    await this.models.require(id);
    return result;
  }
  async resolveDataModelFile(id: string, mode?: PropertySetMode) {
    mode ??= (await this.properties.info(id)).mode;
    propertyInput(propertyModeSchema, mode);
    const currentMode = (await this.properties.info(id)).mode;
    if (mode === currentMode)
      return await this.resolveFormatFile(id, 'datamodel', 'model.datamodel.json');
    if (mode !== 'embedded')
      fail(
        'INVALID_MODEL',
        'Properties: enable server storage before requesting external references',
      );
    await this.getFormat(id, 'datamodel');
    const fingerprint = await this.fingerprint(await this.models.require(id));
    const target = PropertyDocumentExport.fingerprint(fingerprint);
    let file = await this.cache.getFile(id, target, 'datamodel', 'model.datamodel.json');
    if (!file) {
      await this.queue.wait((await this.queue.enqueue(id, 'export-properties', 'datamodel')).id);
      await this.current(id, fingerprint);
      file = await this.cache.getFile(id, target, 'datamodel', 'model.datamodel.json');
    }
    if (!file) fail('CONVERSION_FAILED', 'Properties: complete export could not be verified');
    return { ...file, mime: 'application/json' };
  }
  async getFormat(
    id: string,
    format: ModelRepresentationFormat,
  ): Promise<ModelFormatRepresentation> {
    const model = await this.models.require(id);
    if (model.format === format && model.entrypoint)
      return {
        modelId: id,
        format,
        entrypoint: model.entrypoint,
        source: 'original',
        files: model.files.map((file) => ({
          path: file.path,
          sha256: file.assetId,
          bytes: file.bytes,
        })),
        warnings: model.warnings,
        cached: true,
      };
    const parsed = z.enum(conversionFormats).safeParse(format);
    if (!parsed.success)
      fail('UNSUPPORTED_FORMAT', 'Get model format: this output is not supported');
    return { ...(await this.convert(id, parsed.data)), source: 'converted' };
  }
  async resolveFormatFile(id: string, format: ModelRepresentationFormat, name: string) {
    relativeFile(this.db.root, name);
    const model = await this.models.require(id);
    if (model.format === format && model.entrypoint) {
      const file = model.files.find((item) => item.path === name);
      if (!file)
        fail(
          'ASSET_NOT_FOUND',
          'Resolve model format: file does not belong to this representation',
        );
      return {
        path: this.assets.path(file.assetId),
        mime: mime(name),
        bytes: file.bytes,
        sha256: file.assetId,
      };
    }
    const parsed = z.enum(conversionFormats).safeParse(format);
    if (!parsed.success) fail('UNSUPPORTED_FORMAT', 'Resolve model format: unsupported format');
    const fingerprint = await this.fingerprint(model);
    let file = await this.cache.getFile(id, fingerprint, parsed.data, name);
    if (!file) {
      await this.convert(id, parsed.data);
      await this.current(id, fingerprint);
      file = await this.cache.getFile(id, fingerprint, parsed.data, name);
    }
    if (!file) fail('CONVERSION_FAILED', 'Resolve model format: output file could not be verified');
    return { ...file, mime: mime(name) };
  }
  async convert(id: string, format: ConversionFormat): Promise<ConvertedModel> {
    if (!z.enum(conversionFormats).safeParse(format).success)
      fail('UNSUPPORTED_FORMAT', 'Convert model: unsupported output format');
    const model = await this.models.require(id),
      fingerprint = await this.fingerprint(model);
    const cached = await this.cache.get(id, fingerprint, format);
    if (cached) return cached;
    if (model.format === 'ifc' && format === 'xgf') return await this.prepareIFC(id);
    const options = await this.formats(id);
    if (!options.formats.some((option) => option.format === format))
      fail(
        'UNSUPPORTED_FORMAT',
        'Convert model: this format is not compatible with the source geometry',
      );
    // Preparation may already have published the requested semantic companion.
    const prepared = await this.cache.get(id, fingerprint, format);
    if (prepared) return prepared;
    await this.queue.wait((await this.queue.enqueue(id, 'convert', format)).id);
    await this.current(id, fingerprint);
    const result = await this.cache.get(id, fingerprint, format);
    if (!result) fail('CONVERSION_FAILED', 'Convert model: cached output could not be verified');
    return { ...result, cached: false };
  }
  async export(id: string, format: ConversionFormat, outputPath: string) {
    const converted = await this.convert(id, format);
    const directory = this.cache.directory(
      id,
      await this.fingerprint(await this.models.require(id)),
      format,
    );
    noLinks(outputPath);
    if (fs.existsSync(outputPath)) fail('CONFLICT', 'Export conversion: output already exists');
    if (converted.files.length === 1)
      await copyConversionFile(relativeFile(directory, converted.entrypoint), outputPath);
    else
      await writeBundle(
        outputPath,
        converted.files.map((file) => ({
          name: file.path,
          path: relativeFile(directory, file.path),
        })),
        { maxEntries: CONVERSION_LIMITS.files },
      );
    return {
      ...converted,
      outputPath: path.resolve(outputPath),
      filename: converted.files.length === 1 ? converted.entrypoint : 'model-' + format + '.zip',
    };
  }

  private async work(
    job: ProcessingJob,
    signal: AbortSignal,
    report: (progress: ProcessingProgress) => void,
  ) {
    const model = await this.models.require(job.modelId),
      fingerprint = await this.fingerprint(model);
    const mode = (await this.properties.info(model.id)).mode;
    const checkJob = async () => {
      await this.current(model.id, fingerprint);
      if ((await this.queue.repository.get(job.id))?.status !== 'running' || signal.aborted)
        fail('CONVERSION_CANCELLED', 'Conversion cancelled');
    };
    if (job.kind === 'export-properties') {
      await new PropertyDocumentExport(
        this.cache,
        this.properties,
        this.runner,
        this.publisher,
      ).run(model, fingerprint, signal, report, checkJob);
      return;
    }
    if (job.kind === 'prepare-ifc' && !this.cache.has(model.id, fingerprint, 'xgf')) {
      const candidates: { fingerprint: string; mode: PropertySetMode }[] = [
        {
          fingerprint: await this.fingerprint(model, mode === 'external' ? 'embedded' : 'external'),
          mode: mode === 'external' ? 'embedded' : 'external',
        },
        ...(previousConverterRevision
          ? [
              {
                fingerprint: await this.fingerprint(
                  model,
                  'embedded',
                  previousConverterRevision,
                  true,
                ),
                mode: 'embedded' as const,
              },
            ]
          : []),
      ];
      await new IFCPreparationReuse(
        this.cache,
        this.properties,
        this.runner,
        this.publisher,
      ).prepare(model, fingerprint, mode, candidates, signal, report, checkJob);
    }
    const format = job.format as ConversionFormat;
    if (job.kind === 'inspect' && this.cache.readOptions(model.id, fingerprint)) return;
    const existing =
      job.kind === 'inspect' ||
      (job.kind === 'prepare-ifc' &&
        mode === 'external' &&
        (!(await this.properties.info(model.id)).ready ||
          (await this.properties.info(model.id)).revision !== fingerprint))
        ? null
        : await this.cache.get(model.id, fingerprint, format);
    const thumbnailOnly =
      job.kind === 'thumbnail' ||
      (job.kind === 'prepare-ifc' && !!existing && !!this.cache.readOptions(model.id, fingerprint));
    if (thumbnailOnly && (await this.thumbnails.resolve(model.id, fingerprint))) return;
    if (
      job.kind !== 'inspect' &&
      job.kind !== 'prepare-ifc' &&
      job.kind !== 'thumbnail' &&
      existing
    )
      return;
    report({ phase: 'Preparing files' });
    const canonical =
      model.format === 'ifc' && (job.kind === 'convert' || thumbnailOnly)
        ? await this.cache.get(model.id, fingerprint, 'xgf')
        : null;
    if (model.format === 'ifc' && (job.kind === 'convert' || thumbnailOnly) && !canonical)
      fail(
        'CONVERSION_FAILED',
        'IFC preparation is missing or damaged. Request the format again to rebuild it.',
      );
    const files = canonical
      ? canonical.files
          .filter((file) => !file.path.startsWith('provenance/'))
          .map((file) => ({
            ...file,
            source: relativeFile(this.cache.directory(model.id, fingerprint, 'xgf'), file.path),
          }))
      : model.files.map((file) => ({
          path: file.path,
          bytes: file.bytes,
          sha256: file.assetId,
          source: this.assets.path(file.assetId),
        }));
    const stage = await stageConversion(files, signal);
    try {
      const check = async () => {
        await this.current(model.id, fingerprint);
        if ((await this.queue.repository.get(job.id))?.status !== 'running')
          fail('CONVERSION_CANCELLED', 'Conversion cancelled');
      };
      if (format === 'datamodel' && canonical) {
        const name = 'model.datamodel.json';
        await copyConversionFile(
          relativeFile(stage.input, name),
          relativeFile(stage.output, name),
          signal,
        );
        await this.publisher.publish(
          model,
          fingerprint,
          format,
          { entrypoint: name, files: [name], warnings: ['xeokit DataModel JSON.'] },
          stage.output,
          signal,
          check,
        );
        return;
      }
      const result = await this.runner.run(
        {
          propertySetMode: mode,
          propertyModelId: model.id,
          propertyRevision: fingerprint,
          ...(canonical && mode === 'external'
            ? {
                propertyDatabaseFile: await this.properties.file(
                  model.id,
                  fingerprint,
                  stage.root,
                  signal,
                ),
              }
            : {}),
          sourceFormat: canonical ? 'xgf' : model.format!,
          entrypoint: relativeFile(stage.input, canonical ? 'model.xgf' : model.entrypoint!),
          materialFiles: stage.materialFiles,
          output: stage.output,
          ...(job.kind === 'inspect' || thumbnailOnly ? {} : { format }),
          thumbnailOnly,
          makeThumbnail: job.kind === 'prepare-ifc' && !thumbnailOnly,
          includeOptions: job.kind === 'prepare-ifc',
          ...(canonical && canonical.files.some((file) => file.path === 'model.datamodel.json')
            ? { dataModelFile: relativeFile(stage.input, 'model.datamodel.json') }
            : {}),
        },
        stage.input,
        signal,
        report,
      );
      const saveThumbnail = async (name: string) => {
        await this.thumbnails.install(
          model.id,
          fingerprint,
          relativeFile(stage.output, name),
          async (commit) =>
            await this.db.transaction(async () => {
              await this.db.lock('model:' + model.id);
              await check();
              if (signal.aborted) fail('CONVERSION_CANCELLED', 'Thumbnail cancelled');
              commit();
            }),
        );
      };
      if (thumbnailOnly) {
        const resultThumbnail = this.checked(
          z.object({ thumbnail: z.literal('thumbnail.png') }),
          result,
        );
        await saveThumbnail(resultThumbnail.thumbnail);
        return;
      }
      if (job.kind === 'inspect') {
        const options = this.checked(optionsSchema, result);
        await this.db.transaction(async () => {
          await this.db.lock('model:' + model.id);
          await check();
          if (signal.aborted) fail('CONVERSION_CANCELLED', 'Conversion cancelled');
          this.cache.writeOptions(model.id, fingerprint, options);
        });
        return;
      }
      const output = this.checked(conversionResultSchema, result);
      report({ phase: 'Verifying and caching' });
      const propertyInstall = output.propertyDatabase
        ? await this.properties.prepareInstall(
            model.id,
            fingerprint,
            relativeFile(stage.output, output.propertyDatabase),
            signal,
          )
        : undefined;
      try {
        await this.publisher.publish(
          model,
          fingerprint,
          format,
          output,
          stage.output,
          signal,
          check,
          async () => {
            await propertyInstall?.commit();
            if (output.options) this.cache.writeOptions(model.id, fingerprint, output.options);
          },
        );
      } finally {
        await propertyInstall?.cleanup();
      }
      if (output.thumbnail) await saveThumbnail(output.thumbnail);
      if (job.kind === 'prepare-ifc' && output.files.includes('model.datamodel.json')) {
        // This second representation copies the already exported JSON; IFC is never loaded again.
        const semantic = path.join(stage.root, 'semantic');
        await fs.promises.mkdir(semantic);
        await copyConversionFile(
          relativeFile(stage.output, 'model.datamodel.json'),
          relativeFile(semantic, 'model.datamodel.json'),
          signal,
        );
        await this.publisher.publish(
          model,
          fingerprint,
          'datamodel',
          {
            entrypoint: 'model.datamodel.json',
            files: ['model.datamodel.json'],
            warnings: ['xeokit DataModel JSON.'],
          },
          semantic,
          signal,
          check,
        );
      }
    } finally {
      await fs.promises.rm(stage.root, { recursive: true, force: true });
    }
  }
}
