import fs from 'node:fs';
import path from 'node:path';
import type { ModelRecord } from '../domain/types.js';
import type { ProcessingProgress } from '../processing/types.js';
import type { PropertySetMode } from '../properties/types.js';
import { ModelPropertyStore } from '../properties/ModelPropertyStore.js';
import { ConversionCache, conversionResultSchema } from './ConversionCache.js';
import { ConversionRunner } from './ConversionRunner.js';
import { ConversionPublisher } from './ConversionPublisher.js';
import { stageConversion } from './ConversionStaging.js';
import { copyConversionFile } from './ConversionFiles.js';
import { relativeFile } from '../storage/paths.js';

/**
 * Reuses a verified IFC preparation when only property storage changes.
 * Geometry is copied unchanged; a bounded worker transforms just the semantic file.
 */
export class IFCPreparationReuse {
  constructor(
    private readonly cache: ConversionCache,
    private readonly properties: ModelPropertyStore,
    private readonly runner: ConversionRunner,
    private readonly publisher: ConversionPublisher,
  ) {}
  async prepare(
    model: ModelRecord,
    target: string,
    mode: PropertySetMode,
    candidates: { fingerprint: string; mode: PropertySetMode }[],
    signal: AbortSignal,
    report: (progress: ProcessingProgress) => void,
    check: () => void,
  ): Promise<boolean> {
    for (const candidate of candidates) {
      const original = await this.cache.get(model.id, candidate.fingerprint, 'xgf');
      const options = this.cache.readOptions(model.id, candidate.fingerprint);
      if (
        !original ||
        !options ||
        !original.files.some((file) => file.path === 'model.datamodel.json')
      )
        continue;
      const propertyDatabaseFile =
        candidate.mode === 'external'
          ? this.properties.file(model.id, candidate.fingerprint)
          : undefined;
      if (propertyDatabaseFile && !fs.existsSync(propertyDatabaseFile)) continue;
      const files = original.files
        .filter((file) => !file.path.startsWith('provenance/'))
        .map((file) => ({
          ...file,
          source: relativeFile(
            this.cache.directory(model.id, candidate.fingerprint, 'xgf'),
            file.path,
          ),
        }));
      const stage = await stageConversion(files, signal);
      try {
        report({
          phase: mode === 'external' ? 'Storing properties in database' : 'Embedding properties',
        });
        const output = conversionResultSchema.parse(
          await this.runner.run(
            {
              sourceFormat: 'xgf',
              entrypoint: relativeFile(stage.input, 'model.xgf'),
              materialFiles: [],
              output: stage.output,
              dataModelFile: relativeFile(stage.input, 'model.datamodel.json'),
              propertyTask: mode === 'external' ? 'externalize' : 'embed',
              propertyDatabaseFile,
              propertyModelId: model.id,
              propertyRevision: target,
            },
            stage.input,
            signal,
            report,
          ),
        );
        for (const file of files) {
          if (file.path === 'model.datamodel.json') continue;
          await copyConversionFile(
            relativeFile(stage.input, file.path),
            relativeFile(stage.output, file.path),
            signal,
          );
        }
        const installation = output.propertyDatabase
          ? await this.properties.prepareInstall(
              model.id,
              target,
              path.join(stage.output, output.propertyDatabase),
              signal,
            )
          : undefined;
        try {
          await this.publisher.publish(
            model,
            target,
            'xgf',
            {
              entrypoint: original.entrypoint,
              files: files.map((file) => file.path),
              warnings: original.warnings,
            },
            stage.output,
            signal,
            check,
            () => {
              installation?.commit();
              this.cache.writeOptions(model.id, target, options);
            },
          );
        } finally {
          await installation?.cleanup();
        }
        // Each representation gets its own source notices. Use a separate directory
        // so publishing the JSON cannot collide with notices already added to XGF.
        const semantic = path.join(stage.root, 'semantic');
        await fs.promises.mkdir(semantic);
        await copyConversionFile(
          relativeFile(stage.output, output.entrypoint),
          relativeFile(semantic, output.entrypoint),
          signal,
        );
        await this.publisher.publish(model, target, 'datamodel', output, semantic, signal, check);
        return true;
      } finally {
        await fs.promises.rm(stage.root, { recursive: true, force: true });
      }
    }
    return false;
  }
}
