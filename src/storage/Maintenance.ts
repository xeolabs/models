import fs from 'node:fs';
import path from 'node:path';
import { Database } from './Database.js';
import { AssetStore, inspectAsync } from './AssetStore.js';
import { ModelRepository } from './ModelRepository.js';
import { metadataSchema } from '../domain/schema.js';
import { noLinks, relativeFile } from './paths.js';

/**
 * Validation never mutates files. GC holds the same writer lock used by imports.
 */
export class Maintenance {
  constructor(
    private readonly db: Database,
    private readonly assets: AssetStore,
  ) {}
  async validate() {
    const errors: string[] = [],
      warnings: string[] = [];
    if ((await this.db.one('SELECT max(version) version FROM schema_migrations'))?.version !== 1)
      errors.push('Unsupported PostgreSQL schema');
    const repo = new ModelRepository(this.db);
    for (const row of await this.db.all('SELECT id FROM models', [])) {
      try {
        const m = await repo.require(row.id as string);
        if (!metadataSchema.safeParse(m.metadata).success) errors.push('Invalid metadata: ' + m.id);
        if (m.entrypoint && !m.files.some((f) => f.path === m.entrypoint))
          errors.push('Missing entrypoint: ' + m.id);
        for (const f of m.files) relativeFile(this.db.root, f.path);
      } catch (e) {
        errors.push(String(e));
      }
    }
    const referenced = new Set(
      (await this.db.all('SELECT DISTINCT asset_id id FROM model_files', [])).map(
        (r) => r.id as string,
      ),
    );
    const known = new Set<string>();
    for (const row of await this.db.all('SELECT * FROM assets', [])) {
      const id = row.id as string;
      known.add(id);
      try {
        const actual = await inspectAsync(this.assets.path(id));
        if (actual.id !== id || actual.bytes !== row.bytes)
          errors.push('Hash or size mismatch: ' + id);
      } catch {
        errors.push('Missing or unsafe asset: ' + id);
      }
      if (!referenced.has(id)) warnings.push('Unreferenced asset: ' + id);
    }
    const root = path.join(this.db.root, 'assets', 'sha256');
    if (fs.existsSync(root)) {
      noLinks(root);
      for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
        if (shard.isSymbolicLink()) {
          errors.push('Symlink in asset storage');
          continue;
        }
        if (!shard.isDirectory()) continue;
        for (const file of fs.readdirSync(path.join(root, shard.name), { withFileTypes: true })) {
          if (file.isSymbolicLink()) errors.push('Symlink in asset shard');
          else if (!known.has(file.name))
            warnings.push('Unreferenced file: ' + shard.name + '/' + file.name);
        }
      }
    }
    return { errors, warnings, ok: errors.length === 0 };
  }
  async gc(dryRun = true) {
    return await this.db.transaction(async () => {
      await this.db.lock('assets');
      const rows = await this.db.all(
        'SELECT id,bytes FROM assets WHERE NOT EXISTS(SELECT 1 FROM model_files WHERE asset_id=assets.id)',
        [],
      );
      const known = new Set(
        (await this.db.all('SELECT id FROM assets', [])).map((row) => row.id as string),
      );
      const root = path.join(this.db.root, 'assets', 'sha256');
      const orphans: { path: string; bytes: number }[] = [];
      if (fs.existsSync(root)) {
        noLinks(root);
        for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
          if (!shard.isDirectory() || !/^[a-f0-9]{2}$/.test(shard.name)) continue;
          const directory = path.join(root, shard.name);
          for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
            if (!file.isFile() || known.has(file.name)) continue;
            if (
              !/^[a-f0-9]{64}(?:\.partial-[a-f0-9-]{36})?$/.test(file.name) ||
              !file.name.startsWith(shard.name)
            )
              continue;
            const absolute = path.join(directory, file.name);
            noLinks(absolute);
            orphans.push({ path: absolute, bytes: fs.statSync(absolute).size });
          }
        }
      }
      if (!dryRun) {
        for (const row of rows) {
          fs.rmSync(this.assets.path(row.id as string), { force: true });
          await this.db.query('DELETE FROM assets WHERE id=$1', [row.id!]);
        }
        for (const orphan of orphans) fs.rmSync(orphan.path, { force: true });
      }
      return {
        dryRun,
        assets: rows.map((row) => row.id as string),
        orphanFiles: orphans.map((file) => path.relative(this.db.root, file.path)),
        reclaimableBytes:
          rows.reduce((n, row) => n + Number(row.bytes), 0) +
          orphans.reduce((n, file) => n + file.bytes, 0),
      };
    });
  }
}
