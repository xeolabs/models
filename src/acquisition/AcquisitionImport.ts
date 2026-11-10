import fs from 'node:fs';
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
    const packageRoot = path.join(root, 'package');
    fs.mkdirSync(packageRoot);
    const files = item.files.map((file, i) => {
      signal?.throwIfAborted();
      const name = file.packagePath ?? file.filename,
        destination = relativeFile(packageRoot, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(downloads[i].path, destination, fs.constants.COPYFILE_EXCL);
      return { path: name, sha256: downloads[i].sha256 };
    });
    const entry = item.files.find((f) => f.role === 'entrypoint')!;
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
      entrypoint: entry.packagePath ?? entry.filename,
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
