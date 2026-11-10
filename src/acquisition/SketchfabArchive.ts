import fs from 'node:fs';
import { extractArchive } from '../importing/Bundle.js';
import { relativeFile } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';

/**
 * Sketchfab's glTF archive has a root scene.gltf and its relative resources.
 * The ordinary library importer still validates every declared dependency.
 */
export class SketchfabArchive {
  async prepare(file: string, stagingRoot: string, signal?: AbortSignal) {
    const root = await extractArchive(file, {
      requireManifest: false,
      maxCompressionRatio: 200,
      signal,
      stagingParent: stagingRoot,
    });
    const files: { path: string }[] = [];
    const walk = (directory: string, prefix = '') => {
      for (const entry of fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        signal?.throwIfAborted();
        const name = prefix + entry.name;
        if (entry.isDirectory()) walk(relativeFile(root, name), name + '/');
        else if (entry.isFile()) files.push({ path: name });
        else fail('INVALID_BUNDLE', 'Sketchfab: archive contains a special file');
      }
    };
    walk(root);
    if (!files.some((file) => file.path === 'scene.gltf'))
      fail('INVALID_BUNDLE', 'Sketchfab: archive is missing scene.gltf');
    if (files.some((file) => file.path.toLowerCase() === 'manifest.json'))
      fail('INVALID_BUNDLE', 'Sketchfab: archive uses the reserved manifest filename');
    return { root, files, entrypoint: 'scene.gltf' };
  }
}
