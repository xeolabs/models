import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Database } from '../storage/Database.js';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { digest } from './planSchema.js';
import type { ProviderDownloadFile } from '../providers/types.js';
import type { AcquisitionPlanItem } from './types.js';
import type { DownloadedFile } from './DownloadManager.js';
export interface DownloadCacheOptions {
  maxBytes?: number;
  maxAgeMs?: number;
}
interface Entry {
  key: string;
  sha256: string;
  bytes: number;
  storedAt: number;
}

/**
 * Completed downloads are replaceable cache entries, never permanent model assets.
 */
export class DownloadCache {
  readonly root: string;
  private readonly maxBytes: number;
  private readonly maxAgeMs: number;
  constructor(
    private readonly db: Database,
    options: DownloadCacheOptions = {},
  ) {
    this.root = path.join(db.root, '.cache', 'downloads');
    this.maxBytes = options.maxBytes ?? 4 * 1024 ** 3;
    this.maxAgeMs = options.maxAgeMs ?? 7 * 86400000;
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 0 ||
      !Number.isSafeInteger(this.maxAgeMs) ||
      this.maxAgeMs < 0
    )
      fail('INVALID_PLAN', 'Download cache: invalid size or age limit');
    noLinks(this.root);
  }
  key(item: AcquisitionPlanItem, file: ProviderDownloadFile) {
    return digest({
      provider: item.provider,
      remoteId: item.remoteId,
      resolution: item.resolution,
      format: item.format,
      revision: item.model.metadata?.filesHash,
      file,
    });
  }
  private entries(): Entry[] {
    noLinks(this.root);
    if (!fs.existsSync(this.root)) return [];
    const entries: Entry[] = [];
    for (const name of fs.readdirSync(this.root))
      if (/^[a-f0-9]{64}\.json$/.test(name)) {
        const file = path.join(this.root, name);
        noLinks(file);
        try {
          const e = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (
            e.key !== name.slice(0, -5) ||
            !/^[a-f0-9]{64}$/.test(e.sha256) ||
            !Number.isSafeInteger(e.bytes) ||
            e.bytes < 0 ||
            !Number.isFinite(e.storedAt)
          )
            continue;
          entries.push(e);
        } catch {

          /*
           * Invalid metadata is never treated as a valid cache hit.
           */
        }
      }
    return entries.sort((a, b) => a.storedAt - b.storedAt || a.key.localeCompare(b.key));
  }
  private remove(key: string) {
    for (const suffix of ['.bin', '.json']) {
      const file = path.join(this.root, key + suffix);
      noLinks(file);
      fs.rmSync(file, { force: true });
    }
  }
  async get(
    item: AcquisitionPlanItem,
    file: ProviderDownloadFile,
    directory: string,
  ): Promise<DownloadedFile | undefined> {
    const key = this.key(item, file),
      target = path.join(directory, randomUUID() + '-' + file.filename);
    const entry = this.db.transaction(() => {
      const found = this.entries().find((e) => e.key === key);
      if (!found) return undefined;
      if (Date.now() - found.storedAt > this.maxAgeMs) {
        this.remove(key);
        return undefined;
      }
      const binary = path.join(this.root, key + '.bin');
      noLinks(binary);
      if (!fs.existsSync(binary)) {
        this.remove(key);
        return undefined;
      }
      fs.copyFileSync(binary, target, fs.constants.COPYFILE_EXCL);
      return found;
    });
    if (!entry) return undefined;
    const sha = createHash('sha256'),
      providerHash = file.checksum ? createHash(file.checksum.algorithm) : undefined;
    let bytes = 0;
    try {
      for await (const chunk of fs.createReadStream(target)) {
        bytes += chunk.length;
        if (bytes > 512 * 1024 ** 2) break;
        sha.update(chunk);
        providerHash?.update(chunk);
      }
      if (
        bytes !== entry.bytes ||
        bytes > 512 * 1024 ** 2 ||
        (file.sizeBytes !== undefined && bytes !== file.sizeBytes) ||
        sha.digest('hex') !== entry.sha256 ||
        (providerHash && providerHash.digest('hex') !== file.checksum!.value)
      ) {
        this.db.transaction(() => this.remove(key));
        fs.rmSync(target, { force: true });
        return undefined;
      }
      return { path: target, sha256: entry.sha256, bytes };
    } catch (error) {
      fs.rmSync(target, { force: true });
      throw error;
    }
  }
  put(item: AcquisitionPlanItem, file: ProviderDownloadFile, download: DownloadedFile) {
    if (download.bytes > this.maxBytes || this.maxAgeMs === 0) return;
    this.db.transaction(() => {
      noLinks(this.root);
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      // A crash can leave a completed binary without its metadata. These are safe to reclaim.
      const known = new Set(this.entries().map((entry) => entry.key));
      for (const name of fs.readdirSync(this.root)) {
        if (
          /^[a-f0-9]{64}\.(bin|json)$/.test(name) &&
          !known.has(name.slice(0, -5)) &&
          !known.has(name.slice(0, -4))
        ) {
          const file = path.join(this.root, name);
          noLinks(file);
          fs.rmSync(file);
        } else if (/^\.stage-[a-f0-9-]+$/.test(name)) {
          const file = path.join(this.root, name);
          noLinks(file);
          fs.rmSync(file);
        }
      }
      let entries = this.entries();
      for (const e of entries) if (Date.now() - e.storedAt > this.maxAgeMs) this.remove(e.key);
      entries = this.entries();
      let total = entries.reduce((n, e) => n + e.bytes, 0);
      const key = this.key(item, file);
      for (const e of entries) {
        if (total + download.bytes <= this.maxBytes) break;
        this.remove(e.key);
        total -= e.bytes;
      }
      const binary = path.join(this.root, key + '.bin'),
        meta = path.join(this.root, key + '.json');
      noLinks(binary);
      noLinks(meta);
      const stage = path.join(this.root, '.stage-' + randomUUID());
      try {
        fs.copyFileSync(download.path, stage, fs.constants.COPYFILE_EXCL);
        const fd = fs.openSync(stage, 'r');
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(stage, binary);
        fs.writeFileSync(
          stage,
          JSON.stringify({
            key,
            sha256: download.sha256,
            bytes: download.bytes,
            storedAt: Date.now(),
          } satisfies Entry),
          { flag: 'wx', mode: 0o600 },
        );
        fs.renameSync(stage, meta);
      } finally {
        fs.rmSync(stage, { force: true });
      }
    });
  }
  stats() {
    return this.db.transaction(() => {
      const entries = this.entries();
      return {
        entries: entries.length,
        bytes: entries.reduce((n, e) => n + e.bytes, 0),
        maxBytes: this.maxBytes,
        maxAgeMs: this.maxAgeMs,
        metadataEntries: Number(
          this.db.sql.prepare('SELECT count(*) AS n FROM provider_cache').get()!.n,
        ),
      };
    });
  }
  clear() {
    return this.db.transaction(() => {
      if (
        this.db.sql.prepare("SELECT 1 FROM acquisition_jobs WHERE status='running' LIMIT 1").get()
      )
        fail('JOB_CONFLICT', 'Clear cache: an acquisition job is running');
      const entries = this.entries();
      let files = 0;
      if (fs.existsSync(this.root))
        for (const name of fs.readdirSync(this.root))
          if (/^(?:[a-f0-9]{64}\.(?:bin|json)|\.stage-[a-f0-9-]+)$/.test(name)) {
            const file = path.join(this.root, name);
            noLinks(file);
            if (fs.statSync(file).isFile()) {
              fs.unlinkSync(file);
              files++;
            }
          }
      this.db.sql.exec('DELETE FROM provider_cache');
      return { files, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
    });
  }
}
