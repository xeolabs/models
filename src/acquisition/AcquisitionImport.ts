import fs from 'node:fs';
import { SketchfabArchive } from './SketchfabArchive.js';
import { inspect } from '../storage/AssetStore.js';
import { fail } from '../domain/ModelsError.js';
import path from 'node:path';
import { relativeFile } from '../storage/paths.js';
import type { AcquisitionPlanItem } from './types.js';
import type { DownloadedFile } from './DownloadManager.js';
import type { Manifest } from '../domain/types.js';

/**
 * Rebuild the relative layout before validating the model package. Original bytes
 * and coordinates remain unchanged.
 */
export class AcquisitionImport {
  async prepare(
    item: AcquisitionPlanItem,
    downloads: DownloadedFile[],
    root: string,
    tags: string[],
    signal?: AbortSignal,
  ) {
    const archive =
      item.provider === 'sketchfab' && item.files.length === 1 && item.files[0].role === 'archive'
        ? await new SketchfabArchive().prepare(downloads[0].path, root, signal)
        : undefined;
    const packageRoot = archive?.root ?? path.join(root, 'package');
    if (!archive) fs.mkdirSync(packageRoot);
    const files = archive
      ? archive.files.map((file) => ({
          ...file,
          sha256: inspect(relativeFile(packageRoot, file.path)).id,
        }))
      : item.files.map((file, i) => {
          signal?.throwIfAborted();
          const name = file.packagePath ?? file.filename,
            destination = relativeFile(packageRoot, name);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.copyFileSync(downloads[i].path, destination, fs.constants.COPYFILE_EXCL);
          return { path: name, sha256: downloads[i].sha256 };
        });
    const entry = item.files.find((f) => f.role === 'entrypoint');
    const entrypoint = archive?.entrypoint ?? entry?.packagePath ?? entry?.filename;
    if (!entrypoint) fail('UNSUPPORTED_MODEL_MAPPING', 'Acquired model has no entrypoint');
    const manifest: Manifest = {
      schemaVersion: 1,
      metadata: {
        name: `${item.modelName} (${item.resolution.toUpperCase()})`,
        description: item.model.description,
        tags: [...new Set([...item.model.tags, ...tags])],
        source: {
          provider: item.provider,
          remoteId: item.remoteId,
          resolution: item.resolution,
          url: item.sourceUrl,
          license: item.expectedLicense.id,
          attribution: `${item.modelName}; ${item.model.author ? 'by ' + item.model.author : 'provided by ' + item.provider}; ${item.expectedLicense.name}; ${item.expectedLicense.url ?? ''}; ${item.sourceUrl}. Original source notices are retained in the package.`,
        },
      },
      entrypoint,
      files,
    };
    const manifestPath = path.join(packageRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return {
      manifestPath,
      warnings: item.warnings,
      fileHashes: files.map((f) => ({ filename: f.path, sha256: f.sha256 })),
    };
  }
}
