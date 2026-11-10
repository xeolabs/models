import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { relativeFile, noLinks } from '../storage/paths.js';
import { fail, ModelsError, wrap } from '../domain/ModelsError.js';
export const BUNDLE_LIMITS = {
  entries: 64,
  bytes: 512 * 1024 * 1024,
  entryBytes: 256 * 1024 * 1024,
};

/**
 * Extract into a private temporary directory, with limits on both declared and
 * actual expanded sizes. Nothing reaches the library until validation succeeds.
 */
export async function extractBundle(file: string): Promise<string> {
  return extractArchive(file, { requireManifest: true });
}

/**
 * Shared secure extraction for bundles and provider archives; entries are never executed.
 */
export async function extractArchive(
  file: string,
  options: {
    requireManifest: boolean;
    maxCompressionRatio?: number;
    signal?: AbortSignal;
    stagingParent?: string;
  },
): Promise<string> {
  noLinks(file);
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > BUNDLE_LIMITS.bytes)
    fail('INVALID_BUNDLE', 'Import bundle: archive exceeds limit');
  const parent = options.stagingParent ?? os.tmpdir();
  noLinks(parent);
  const root = fs.mkdtempSync(path.join(parent, 'models-bundle-'));
  let zip: yauzl.ZipFile | undefined;
  try {
    zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
      yauzl.open(
        file,
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
        (e, z) => (e ? reject(e) : resolve(z!)),
      ),
    );
    if (zip.entryCount > BUNDLE_LIMITS.entries)
      fail('INVALID_BUNDLE', 'Import bundle: entry count exceeds limit');
    let total = 0;
    const names = new Set<string>();
    const archive = zip;
    await new Promise<void>((resolve, reject) => {
      archive.on('error', reject);
      archive.on('end', resolve);
      archive.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          options.signal?.throwIfAborted();
          if (
            entry.uncompressedSize / Math.max(1, entry.compressedSize) >
            (options.maxCompressionRatio ?? Infinity)
          )
            fail('INVALID_BUNDLE', 'Import archive: compression ratio exceeds limit');
          const name = entry.fileName;
          const target = relativeFile(root, name.endsWith('/') ? name.slice(0, -1) : name);
          if (names.has(name)) fail('INVALID_BUNDLE', 'Import bundle: duplicate entry');
          names.add(name);
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode === 0xa000 || (mode !== 0 && mode !== 0x8000 && mode !== 0x4000))
            fail('INVALID_BUNDLE', 'Import bundle: symlink or special file');
          if (entry.isEncrypted() || entry.uncompressedSize > BUNDLE_LIMITS.entryBytes)
            fail('INVALID_BUNDLE', 'Import bundle: encrypted or oversized entry');
          if (name.endsWith('/')) {
            fs.mkdirSync(target, { recursive: true });
            archive.readEntry();
            return;
          }
          const input = await new Promise<NodeJS.ReadableStream>((res, rej) =>
            archive.openReadStream(entry, (e, s) => (e ? rej(e) : res(s!))),
          );
          let count = 0;
          const guard = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              count += chunk.length;
              total += chunk.length;
              if (count > BUNDLE_LIMITS.entryBytes || total > BUNDLE_LIMITS.bytes)
                callback(new ModelsError('INVALID_BUNDLE', 'Import bundle: expanded size limit'));
              else callback(null, chunk);
            },
          });
          fs.mkdirSync(path.dirname(target), { recursive: true });
          await pipeline(input, guard, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }), {
            signal: options.signal,
          });
          archive.readEntry();
        })().catch(reject);
      });
      archive.readEntry();
    });
    if (options.requireManifest && !names.has('manifest.json'))
      fail('INVALID_BUNDLE', 'Import bundle: missing manifest.json');
    return root;
  } catch (e) {
    zip?.close();
    fs.rmSync(root, { recursive: true, force: true });
    if (e instanceof ModelsError) throw e;
    throw new ModelsError('INVALID_BUNDLE', `Import bundle: ${(e as Error).message}`, {
      cause: e,
    });
  } finally {
    zip?.close();
  }
}
export async function writeBundle(
  output: string,
  files: { path: string; name: string }[],
  options: { maxEntries?: number } = {},
): Promise<void> {
  noLinks(output);
  if (fs.existsSync(output)) fail('CONFLICT', `Export bundle: output exists ${output}`);
  if (files.length > (options.maxEntries ?? BUNDLE_LIMITS.entries))
    fail('INVALID_BUNDLE', 'Export bundle: too many files for a portable bundle');
  let total = 0;
  const names = new Set<string>();
  for (const file of files) {
    relativeFile(os.tmpdir(), file.name);
    if (names.has(file.name.toLowerCase())) fail('INVALID_BUNDLE', 'Export bundle: duplicate path');
    names.add(file.name.toLowerCase());
    noLinks(file.path);
    const stat = fs.statSync(file.path);
    total += stat.size;
    if (!stat.isFile() || stat.size > BUNDLE_LIMITS.entryBytes || total > BUNDLE_LIMITS.bytes)
      fail('INVALID_BUNDLE', 'Export bundle: package exceeds portable bundle limits');
  }
  const stage = output + '.stage-' + randomUUID();
  try {
    const zip = new yazl.ZipFile();
    for (const file of files) {
      noLinks(file.path);
      zip.addFile(file.path, file.name, {
        mtime: new Date('2000-01-01T00:00:00Z'),
        mode: 0o100644,
      });
    }
    zip.on('error', (error) => (zip.outputStream as Readable).destroy(error));
    zip.end();
    await pipeline(zip.outputStream, fs.createWriteStream(stage, { flags: 'wx', mode: 0o600 }));
    fs.linkSync(stage, output);
  } catch (e) {
    throw wrap(e, 'Export bundle');
  } finally {
    fs.rmSync(stage, { force: true });
  }
}
