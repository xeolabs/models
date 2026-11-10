import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConversionCache } from './ConversionCache.js';
import { copyConversionFile, inspectConversionFile } from './ConversionFiles.js';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
const schema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(2 * 1024 ** 2),
});

/**
 * A thumbnail is a disposable derivative, separate from downloadable geometry.
 * Replacing a damaged preview never invalidates an expensive IFC preparation.
 */
export class ConversionThumbnailStore {
  constructor(private readonly cache: ConversionCache) {}
  private directory(id: string, fingerprint: string) {
    const result = path.join(this.cache.directory(id, fingerprint), 'preview');
    noLinks(result);
    return result;
  }
  info(id: string, fingerprint: string) {
    const directory = this.directory(id, fingerprint);
    try {
      const manifest = path.join(directory, 'manifest.json');
      noLinks(manifest);
      if (fs.statSync(manifest).size > 1024) return null;
      const result = schema.parse(JSON.parse(fs.readFileSync(manifest, 'utf8'))),
        file = path.join(directory, 'thumbnail.png');
      noLinks(file);
      if (fs.statSync(file).size !== result.bytes) return null;
      return { ...result, path: file };
    } catch {
      return null;
    }
  }
  async resolve(id: string, fingerprint: string) {
    const info = this.info(id, fingerprint);
    if (!info) return null;
    try {
      if ((await inspectConversionFile(info.path)).id !== info.sha256) return null;
      return { ...info, mime: 'image/png' };
    } catch {
      return null;
    }
  }
  async install(
    id: string,
    fingerprint: string,
    source: string,
    publish: (commit: () => void) => void,
  ) {
    const actual = await inspectConversionFile(source);
    if (actual.bytes > 2 * 1024 ** 2) fail('CONVERSION_FAILED', 'Thumbnail exceeds its size limit');
    const signature = Buffer.alloc(8),
      file = await fs.promises.open(source, 'r');
    try {
      await file.read(signature, 0, 8, 0);
    } finally {
      await file.close();
    }
    if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      fail('CONVERSION_FAILED', 'Invalid thumbnail PNG');
    const directory = this.directory(id, fingerprint),
      temp = directory + '.partial-' + randomUUID();
    await fs.promises.mkdir(temp, { recursive: true });
    try {
      await copyConversionFile(source, path.join(temp, 'thumbnail.png'));
      await fs.promises.writeFile(
        path.join(temp, 'manifest.json'),
        JSON.stringify({ bytes: actual.bytes, sha256: actual.id }),
      );
      publish(() => {
        fs.rmSync(directory, { recursive: true, force: true });
        fs.renameSync(temp, directory);
      });
    } finally {
      await fs.promises.rm(temp, { recursive: true, force: true });
    }
  }
}
