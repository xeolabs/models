import fs from 'node:fs';
import path from 'node:path';
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
 * Files keep their original bytes. Package paths live in SQLite, separately from hashes.
 */
export class AssetStore {
  constructor(private readonly db: Database) {}
  path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail('ASSET_NOT_FOUND', 'Resolve file: invalid hash');
    const file = path.join(this.db.root, 'assets', 'sha256', id.slice(0, 2), id);
    noLinks(file);
    return file;
  }
  install(source: string, expected?: string) {
    const asset = inspect(source);
    if (expected && asset.id !== expected)
      fail('HASH_MISMATCH', 'Import file: SHA-256 differs from manifest');
    const target = this.path(asset.id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      if (inspect(target).id !== asset.id)
        fail('HASH_MISMATCH', 'Import file: existing asset is damaged');
    } else {
      const stage = target + '.partial-' + randomUUID();
      try {
        fs.copyFileSync(source, stage, fs.constants.COPYFILE_EXCL);
        if (inspect(stage).id !== asset.id)
          fail('HASH_MISMATCH', 'Import file: source changed while copying');
        fs.linkSync(stage, target);
      } finally {
        fs.rmSync(stage, { force: true });
      }
    }
    this.db.sql
      .prepare('INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?)')
      .run(asset.id, asset.bytes, asset.mime, asset.originalFilename, new Date().toISOString());
    return asset;
  }
}
