import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { ModelRecord } from '../domain/types.js';
import type { ProcessingProgress } from '../processing/types.js';
import { ModelPropertyStore } from '../properties/ModelPropertyStore.js';
import { ConversionCache, conversionResultSchema } from './ConversionCache.js';
import { ConversionRunner } from './ConversionRunner.js';
import { ConversionPublisher } from './ConversionPublisher.js';
import { stageConversion } from './ConversionStaging.js';
import { relativeFile } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';

/**
 * Produces an explicit offline document in a worker. It does not change the
 * model's storage policy or load the complete property database into memory.
 */
export class PropertyDocumentExport {
  constructor(
    private readonly cache: ConversionCache,
    private readonly properties: ModelPropertyStore,
    private readonly runner: ConversionRunner,
    private readonly publisher: ConversionPublisher,
  ) {}
  static fingerprint(source: string): string {
    return createHash('sha256')
      .update('embedded-properties:' + source)
      .digest('hex');
  }
  async run(
    model: ModelRecord,
    fingerprint: string,
    signal: AbortSignal,
    report: (progress: ProcessingProgress) => void,
    check: () => void,
  ): Promise<void> {
    const name = 'model.datamodel.json';
    const source = await this.cache.getFile(model.id, fingerprint, 'datamodel', name);
    if (!source) fail('PROPERTIES_NOT_READY', 'Properties: prepare the semantic document first');
    const target = PropertyDocumentExport.fingerprint(fingerprint);
    if (await this.cache.getFile(model.id, target, 'datamodel', name)) return;
    const stage = await stageConversion(
      [{ path: name, bytes: source.bytes, sha256: source.sha256, source: source.path }],
      signal,
    );
    try {
      report({ phase: 'Preparing complete property download' });
      const result = conversionResultSchema.parse(
        await this.runner.run(
          {
            sourceFormat: 'datamodel',
            entrypoint: relativeFile(stage.input, name),
            dataModelFile: relativeFile(stage.input, name),
            propertyTask: 'embed',
            propertyDatabaseFile: this.properties.file(model.id, fingerprint),
            materialFiles: [],
            output: stage.output,
          },
          stage.input,
          signal,
          report,
        ),
      );
      await this.publisher.publish(model, target, 'datamodel', result, stage.output, signal, check);
    } finally {
      await fs.promises.rm(stage.root, { recursive: true, force: true });
    }
  }
}
