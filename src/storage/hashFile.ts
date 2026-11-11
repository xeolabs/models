import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { noLinks } from './paths.js';
import { fail } from '../domain/ModelsError.js';

/**
 * Hash a local database in bounded reads. Property databases are not subject to
 * geometry download limits and can be much larger than any one model file.
 */
export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  noLinks(file);
  if (!(await fs.promises.stat(file)).isFile())
    fail('FILE_IO_ERROR', 'Hash database: expected a regular file');
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024, signal }))
    hash.update(chunk);
  return hash.digest('hex');
}
