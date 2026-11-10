import fs from 'node:fs';
import path from 'node:path';
import { ModelInspector } from './ModelInspector.js';
import { AssetStore, inspect } from '../storage/AssetStore.js';
import { ModelRepository } from '../storage/ModelRepository.js';
import { relativeFile, noLinks } from '../storage/paths.js';
import { manifestSchema, metadataSchema, parse } from '../domain/schema.js';
import { fail } from '../domain/ModelsError.js';
import type { ImportOptions, ImportReport, ModelRecord } from '../domain/types.js';
export type { Manifest } from '../domain/types.js';

/**
 * Validate the complete package before installing files. The caller owns the
 * transaction, including any acquisition completion marker.
 */
export class Importer {
  constructor(
    private readonly models: ModelRepository,
    private readonly assets: AssetStore,
    private readonly imported?: (model: ModelRecord) => void,
  ) {}
  file(options: ImportOptions): ImportReport {
    const file = path.resolve(options.path),
      inspection = new ModelInspector().inspect(file),
      root = path.dirname(file);
    return this.commit(
      {
        schemaVersion: 1,
        metadata: {
          name: options.name ?? path.basename(file, path.extname(file)),
          description: options.description,
          tags: options.tags,
          source: options.source,
        },
        entrypoint: inspection.entrypoint,
        files: inspection.files.map((path) => ({ path })),
      },
      root,
      !!options.dryRun,
    );
  }
  manifest(
    file: string,
    dryRun = false,
    before?: () => ModelRecord | undefined,
    after?: (m: ModelRecord) => void,
  ) {
    noLinks(file);
    if (fs.statSync(file).size > 8 * 1024 ** 2)
      fail('INVALID_BUNDLE', 'Import manifest: size exceeds 8 MiB');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      fail('INVALID_BUNDLE', 'Import manifest: invalid JSON');
    }
    return this.commit(data, path.dirname(file), dryRun, before, after);
  }
  private commit(
    value: unknown,
    root: string,
    dryRun: boolean,
    before?: () => ModelRecord | undefined,
    after?: (m: ModelRecord) => void,
  ): ImportReport {
    const manifest = parse(manifestSchema, value);
    const names = manifest.files.map((f) => f.path);
    if (names.some((name) => name.toLowerCase() === 'manifest.json'))
      fail('INVALID_BUNDLE', 'Import package: manifest.json is reserved for bundle metadata');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length)
      fail('INVALID_BUNDLE', 'Import package: duplicate or case-conflicting paths');
    if (!names.includes(manifest.entrypoint))
      fail('INVALID_BUNDLE', 'Import package: entrypoint missing from manifest');
    const inspection = new ModelInspector().inspect(relativeFile(root, manifest.entrypoint), root);
    for (const dependency of inspection.files)
      if (!names.includes(dependency))
        fail('INVALID_BUNDLE', 'Import package: dependency omitted from manifest: ' + dependency);
    const checked = manifest.files.map((f) => {
      const file = relativeFile(root, f.path),
        asset = inspect(file);
      if (f.sha256 && f.sha256 !== asset.id)
        fail('HASH_MISMATCH', 'Import package: hash differs for ' + f.path);
      return { path: f.path, file, asset };
    });
    const report: ImportReport = {
      dryRun,
      model: null,
      files: checked.map((f) => ({
        path: f.path,
        sha256: f.asset.id,
        bytes: f.asset.bytes,
        reused: !!this.models.db.sql.prepare('SELECT id FROM assets WHERE id=?').get(f.asset.id),
      })),
      warnings: inspection.warnings,
    };
    const metadata = parse(metadataSchema, {
      ...manifest.metadata,
      source: {
        ...manifest.metadata.source,
        ...(manifest.originalId ? { originalId: manifest.originalId } : {}),
      },
    });
    if (dryRun) return report;
    const existing = before?.();
    if (existing) return { ...report, model: existing };
    for (const f of checked) this.assets.install(f.file, f.asset.id);
    const model = this.models.create(
      metadata,
      inspection.entrypoint,
      inspection.format,
      inspection.warnings,
    );
    for (const f of checked)
      this.models.db.sql
        .prepare('INSERT INTO model_files VALUES(?,?,?)')
        .run(model.id, f.path, f.asset.id);
    report.model = this.models.require(model.id);
    after?.(report.model);
    this.imported?.(report.model);
    return report;
  }
}
