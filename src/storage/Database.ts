import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { noLinks } from './paths.js';
import { fail, wrap } from '../domain/ModelsError.js';
import { propertiesMigration } from './propertiesMigration.js';
import { processingMigration } from './processingMigration.js';
import { acquisitionMigration } from './acquisitionMigration.js';
const schema = `
CREATE TABLE library_info(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
CREATE TABLE models(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,source_json TEXT NOT NULL,entrypoint TEXT,format TEXT,warnings_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE assets(id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>=0),mime TEXT NOT NULL,original_filename TEXT NOT NULL,imported_at TEXT NOT NULL);
CREATE TABLE model_files(model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,path TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES assets(id),PRIMARY KEY(model_id,path));
CREATE INDEX files_asset ON model_files(asset_id);
CREATE TABLE tags(name TEXT PRIMARY KEY);
CREATE TABLE model_tags(model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,tag TEXT NOT NULL REFERENCES tags(name),PRIMARY KEY(model_id,tag));
CREATE INDEX models_name ON models(name,id);
CREATE INDEX models_format ON models(format,id);
CREATE VIRTUAL TABLE model_search USING fts5(id UNINDEXED,name,description,tags,provider,format);
${acquisitionMigration}
PRAGMA user_version=1;
`;

/**
 * SQLite owns metadata. A writer transaction also protects file installation and GC.
 */
export class Database {
  readonly sql: DatabaseSync;
  constructor(
    readonly root: string,
    create = false,
  ) {
    noLinks(root);
    const file = path.join(root, 'models.db');
    const exists = fs.existsSync(file);
    if (!exists && !create) fail('LIBRARY_NOT_FOUND', 'Open library: models.db is missing');
    if (!exists) fs.mkdirSync(root, { recursive: true });
    noLinks(file);
    this.sql = new DatabaseSync(file);
    try {
      this.sql.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;');
      const version = Number(this.sql.prepare('PRAGMA user_version').get()!.user_version);
      if (version > 3) fail('UNSUPPORTED_SCHEMA', 'Open library: newer schema');
      if (version === 0 && exists) fail('INVALID_LIBRARY', 'Open library: unrecognized database');
      if (!exists)
        this.transaction(() => {
          this.sql.exec(schema);
          this.sql
            .prepare('INSERT INTO library_info VALUES(?,?)')
            .run(randomUUID(), new Date().toISOString());
        });
      if (Number(this.sql.prepare('PRAGMA user_version').get()!.user_version) < 2)
        this.transaction(() => {
          if (Number(this.sql.prepare('PRAGMA user_version').get()!.user_version) < 2)
            this.sql.exec(processingMigration);
        });
      if (Number(this.sql.prepare('PRAGMA user_version').get()!.user_version) < 3)
        this.transaction(() => {
          if (Number(this.sql.prepare('PRAGMA user_version').get()!.user_version) < 3)
            this.sql.exec(propertiesMigration);
        });
      if (this.sql.prepare('SELECT count(*) n FROM library_info').get()!.n !== 1)
        fail('INVALID_LIBRARY', 'Open library: invalid identity');
    } catch (e) {
      this.sql.close();
      throw wrap(e, 'Open library');
    }
  }
  transaction<T>(work: () => T): T {
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      this.sql.exec('COMMIT');
      return value;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }
}
