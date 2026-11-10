import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { CONVERSION_LIMITS } from './limits.js';

/**
 * Hash in small asynchronous reads so large cached models do not block API requests.
 */
export async function inspectConversionFile(file: string, signal?: AbortSignal) {
  noLinks(file);
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > CONVERSION_LIMITS.bytes)
    fail('FILE_IO_ERROR', 'Conversion file exceeds the 3 GiB file limit');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024, signal }))
    hash.update(chunk);
  return { id: hash.digest('hex'), bytes: stat.size };
}
export async function copyConversionFile(source: string, target: string, signal?: AbortSignal) {
  if (signal?.aborted) fail('CONVERSION_CANCELLED', 'Conversion cancelled');
  noLinks(source);
  noLinks(target);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(
    source,
    target,
    fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE,
  );
  if (signal?.aborted) fail('CONVERSION_CANCELLED', 'Conversion cancelled');
}
