import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { noLinks } from './paths.js';
import { fail } from '../domain/ModelsError.js';
import { Database } from './Database.js';

/**
 * Local files are hashed and copied in chunks. They may be larger than the
 * separate conversion, browser-upload and remote-download limits.
 */
export const MAX_FILE_BYTES = 4 * 1024 ** 3;
export function signature(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { extension: 'png', mime: 'image/png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    return { extension: 'webp', mime: 'image/webp' };
  return fail('UNSUPPORTED_PREVIEW_FORMAT', 'Preview: expected a raster image');
}
export function inspect(file: string) {
  noLinks(file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
    fail('FILE_IO_ERROR', 'Inspect file: expected a regular file at most 4 GiB');
  const hash = createHash('sha256'),
    buffer = Buffer.alloc(1024 ** 2),
    fd = fs.openSync(file, 'r');
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return {
    id: hash.digest('hex'),
    bytes: stat.size,
    originalFilename: path.basename(file),
    mime: mime(file),
  };
}
export function mime(file: string) {
  return (
    (
      {
        '.gltf': 'model/gltf+json',
        '.glb': 'model/gltf-binary',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      } as Record<string, string>
    )[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  );
}

/**
 * Files keep their original bytes. Package paths live in PostgreSQL, separately from hashes.
 */
export class AssetStore {
  constructor(private readonly db: Database) {}
  async lock(): Promise<void> {
    await this.db.lock('assets');
  }
  path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail('ASSET_NOT_FOUND', 'Resolve file: invalid hash');
    const file = path.join(this.db.root, 'assets', 'sha256', id.slice(0, 2), id);
    noLinks(file);
    return file;
  }

  /**
   * Copy and hash outside the catalog transaction. The private staging directory
   * is outside the asset shards, so GC cannot mistake it for an orphan asset.
   */
  async prepare(source: string, expected: string) {
    noLinks(source);
    const directory = path.join(this.db.root, '.cache', 'imports');
    noLinks(directory);
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const stage = path.join(directory, randomUUID());
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      await pipeline(
        fs.createReadStream(source),
        new Transform({
          transform(chunk, _encoding, done) {
            bytes += chunk.length;
            if (bytes > MAX_FILE_BYTES) return done(new Error('Import exceeds 4 GiB'));
            hash.update(chunk);
            done(null, chunk);
          },
        }),
        fs.createWriteStream(stage, { flags: 'wx', mode: 0o600 }),
      );
      if (hash.digest('hex') !== expected)
        fail('HASH_MISMATCH', 'Import: source changed while staging');
      const target = this.path(expected);
      if (fs.existsSync(target) && (await inspectAsync(target)).id !== expected)
        fail('HASH_MISMATCH', 'Import: existing asset is damaged');
      return {
        id: expected,
        bytes,
        originalFilename: path.basename(source),
        mime: mime(source),
        stage,
      };
    } catch (error) {
      await fs.promises.rm(stage, { force: true });
      throw error;
    }
  }

  /**
   * Install already verified bytes while holding the asset publication lock.
   */
  async install(asset: Awaited<ReturnType<AssetStore['prepare']>>) {
    const target = this.path(asset.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.linkSync(asset.stage, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await this.db.query('INSERT INTO assets VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
      asset.id,
      asset.bytes,
      asset.mime,
      asset.originalFilename,
      new Date().toISOString(),
    ]);
    return asset;
  }
}

/**
 * Hash large input asynchronously without accumulating its contents in memory.
 */
export async function inspectAsync(file: string) {
  noLinks(file);
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
    fail('FILE_IO_ERROR', 'Inspect file: expected a regular file at most 4 GiB');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > MAX_FILE_BYTES) fail('FILE_IO_ERROR', 'Inspect file: size exceeds 4 GiB');
    hash.update(chunk);
  }
  return { id: hash.digest('hex'), bytes, originalFilename: path.basename(file), mime: mime(file) };
}
