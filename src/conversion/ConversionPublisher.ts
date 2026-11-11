import fs from 'node:fs';
import path from 'node:path';
import { relativeFile } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { AssetStore } from '../storage/AssetStore.js';
import { Database } from '../storage/Database.js';
import type { ModelRecord } from '../domain/types.js';
import { CONVERSION_LIMITS } from './limits.js';
import { copyConversionFile, inspectConversionFile } from './ConversionFiles.js';
import { ConversionCache } from './ConversionCache.js';
import type { ConvertedModel, ConversionFormat } from './types.js';

/**
 * Prepare files first, then publish their complete manifest under a short writer
 * transaction. A cancelled job or deleted model cannot publish late results.
 */
export class ConversionPublisher {
  constructor(
    private readonly db: Database,
    private readonly assets: AssetStore,
    private readonly cache: ConversionCache,
  ) {}
  async publish(
    model: ModelRecord,
    fingerprint: string,
    format: ConversionFormat,
    output: { entrypoint: string; files: string[]; warnings: string[] },
    directory: string,
    signal: AbortSignal,
    check: () => void | Promise<void>,
    onCommit: () => void | Promise<void> = () => {},
  ) {
    if (
      new Set(output.files.map((name) => name.toLowerCase())).size !== output.files.length ||
      output.files.some((name) => name.toLowerCase() === 'manifest.json') ||
      !output.files.includes(output.entrypoint)
    )
      fail('CONVERSION_FAILED', 'Convert model: invalid output package');
    const notices = model.files.filter((file) => file.path.startsWith('provenance/'));
    if (notices.length || model.metadata.source.attribution || model.metadata.source.license) {
      for (const notice of notices) {
        if (output.files.includes(notice.path))
          fail('CONVERSION_FAILED', 'Convert model: source notice conflicts with output');
        await copyConversionFile(
          this.assets.path(notice.assetId),
          relativeFile(directory, notice.path),
          signal,
        );
        output.files.push(notice.path);
      }
      let name = 'provenance/conversion-notice.txt';
      for (let suffix = 1; output.files.includes(name); suffix++)
        name = `provenance/conversion-notice-${suffix}.txt`;
      const destination = relativeFile(directory, name);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.writeFile(
        destination,
        [
          model.metadata.name,
          model.metadata.source.attribution ?? '',
          model.metadata.source.url ?? '',
          model.metadata.source.license ?? '',
          `Converted from ${model.format} to ${format} by xeokit SDK v3. This is a derived representation.`,
          ...output.warnings,
        ].join('\n') + '\n',
        { flag: 'wx' },
      );
      output.files.push(name);
    }
    if (output.files.length > CONVERSION_LIMITS.files)
      fail('CONVERSION_FAILED', 'Convert model: output exceeds file limit');
    const files = [];
    for (const name of output.files) {
      const file = await inspectConversionFile(relativeFile(directory, name), signal);
      files.push({ path: name, bytes: file.bytes, sha256: file.id });
    }
    if (files.reduce((sum, file) => sum + file.bytes, 0) > CONVERSION_LIMITS.bytes)
      fail('CONVERSION_FAILED', 'Convert model: output exceeds 3 GiB');
    const converted: ConvertedModel = {
      modelId: model.id,
      format,
      entrypoint: output.entrypoint,
      files,
      warnings: output.warnings,
      createdAt: new Date().toISOString(),
      cached: false,
    };
    const install = await this.cache.prepareInstall(model.id, fingerprint, converted, directory);
    try {
      await this.db.transaction(async () => {
        await this.db.lock('model:' + model.id);
        await check();
        if (signal.aborted) fail('CONVERSION_CANCELLED', 'Convert model: cancelled');
        install.commit();
        await onCommit();
      });
      return converted;
    } finally {
      await install.cleanup();
      // Deletion may have raced with asynchronous staging. Remove even empty
      // cache directories left by that job after the model has gone.
      if (!(await this.db.one('SELECT id FROM models WHERE id=$1', [model.id])))
        this.cache.remove(model.id);
    }
  }
}
