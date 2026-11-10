import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relativeFile } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { CONVERSION_LIMITS } from './limits.js';
import { copyConversionFile, inspectConversionFile } from './ConversionFiles.js';

/**
 * Stage verified copies outside SQLite transactions. Cancel and status requests
 * stay responsive while large input files are copied and hashed.
 */
export async function stageConversion(
  files: { path: string; source: string; sha256: string; bytes: number }[],
  signal: AbortSignal,
) {
  if (
    files.length > CONVERSION_LIMITS.files ||
    files.reduce((sum, file) => sum + file.bytes, 0) > CONVERSION_LIMITS.bytes
  )
    fail('CONVERSION_FAILED', 'Convert model: package exceeds 3 GiB or 4096 files');
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'models-convert-'));
  const input = path.join(root, 'input'),
    output = path.join(root, 'output');
  try {
    await fs.promises.mkdir(input);
    await fs.promises.mkdir(output);
    for (const file of files) {
      const destination = relativeFile(input, file.path);
      await copyConversionFile(file.source, destination, signal);
      if ((await inspectConversionFile(destination, signal)).id !== file.sha256)
        fail('HASH_MISMATCH', 'Convert model: source asset hash mismatch');
    }
    return {
      root,
      input,
      output,
      materialFiles: files
        .filter((file) => file.path.toLowerCase().endsWith('.mtl'))
        .map((file) => relativeFile(input, file.path)),
    };
  } catch (error) {
    await fs.promises.rm(root, { recursive: true, force: true });
    throw error;
  }
}
