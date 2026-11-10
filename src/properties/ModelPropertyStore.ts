import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { Database } from '../storage/Database.js';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { copyConversionFile } from '../conversion/ConversionFiles.js';
import { PropertyDatabaseReader } from './PropertyDatabaseReader.js';
import { propertyInput, propertyModeSchema, propertyRevisionSchema } from './schema.js';
import type { ModelPropertiesInfo, PropertySetMode } from './types.js';

/**
 * Registers model-owned property databases and publishes complete generations.
 * Files are immutable after publication and are never part of the disposable cache.
 */
export class ModelPropertyStore {
  private readonly root: string;
  constructor(private readonly db: Database) {
    this.root = path.join(db.root, 'properties');
    noLinks(this.root);
  }
  private directory(id: string): string {
    propertyInput(z.string().uuid(), id);
    const directory = path.join(this.root, id);
    noLinks(directory);
    return directory;
  }
  initialize(id: string, mode: PropertySetMode): void {
    propertyInput(propertyModeSchema, mode);
    this.db.sql.prepare('INSERT INTO model_properties(model_id,mode) VALUES(?,?)').run(id, mode);
  }
  info(id: string): ModelPropertiesInfo {
    const row = this.db.sql.prepare('SELECT * FROM model_properties WHERE model_id=?').get(id);
    if (!row) fail('MODEL_NOT_FOUND', 'Properties: model does not exist');
    if (row.revision && row.file_name !== row.revision + '.db')
      fail('DATABASE_ERROR', 'Properties: invalid registered database path');
    const ready =
      row.mode === 'external' &&
      !!row.revision &&
      fs.existsSync(path.join(this.directory(id), row.file_name as string));
    return {
      modelId: id,
      mode: row.mode as PropertySetMode,
      ready,
      ...(ready
        ? {
            revision: row.revision as string,
            propertySetCount: Number(row.property_set_count),
            objectCount: Number(row.object_count),
          }
        : {}),
    };
  }
  setMode(id: string, mode: PropertySetMode): void {
    propertyInput(propertyModeSchema, mode);
    this.info(id);
    this.db.sql.prepare('UPDATE model_properties SET mode=? WHERE model_id=?').run(mode, id);
  }
  reader(id: string, revision: string): PropertyDatabaseReader {
    propertyInput(propertyRevisionSchema, revision);
    const info = this.info(id);
    if (!info.ready) fail('PROPERTIES_NOT_READY', 'Properties: prepare this model first');
    if (info.revision !== revision)
      fail(
        'PROPERTY_REVISION_MISMATCH',
        'Properties: reload the model before requesting a different revision',
      );
    return new PropertyDatabaseReader(this.file(id, revision), revision);
  }
  file(id: string, revision: string): string {
    propertyInput(propertyRevisionSchema, revision);
    const file = path.join(this.directory(id), revision + '.db');
    noLinks(file);
    return file;
  }
  async prepareInstall(id: string, revision: string, source: string, signal: AbortSignal) {
    const destination = this.file(id, revision);
    noLinks(source);
    const sourceDb = new DatabaseSync(source, { readOnly: true });
    let sets: number, objects: number;
    try {
      const info = sourceDb.prepare('SELECT * FROM info').get();
      if (
        info?.model_id !== id ||
        info.revision !== revision ||
        info.complete !== 1 ||
        sourceDb.prepare('PRAGMA user_version').get()?.user_version !== 1
      )
        fail(
          'DATABASE_ERROR',
          'Properties: staged database is incomplete or belongs to another model',
        );
      sets = Number(info.property_set_count);
      objects = Number(info.object_count);
    } finally {
      sourceDb.close();
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const staged = destination + '.partial-' + randomUUID();
    try {
      await copyConversionFile(source, staged, signal);
      const hash = await this.hash(staged, signal);
      if (fs.existsSync(destination) && (await this.hash(destination, signal)) !== hash)
        fail('CONFLICT', 'Properties: a different database already uses this revision');
      return {
        commit: () => {
          if (signal.aborted) fail('CONVERSION_CANCELLED', 'Properties: publication cancelled');
          if (this.info(id).mode !== 'external')
            fail('CONFLICT', 'Properties: storage mode changed');
          if (!fs.existsSync(destination)) fs.renameSync(staged, destination);
          this.db.sql
            .prepare(
              `UPDATE model_properties SET revision=?,file_name=?,property_set_count=?,object_count=? WHERE model_id=?`,
            )
            .run(revision, path.basename(destination), sets, objects, id);
        },
        cleanup: async () => {
          await fs.promises.rm(staged, { force: true });
          if (!this.db.sql.prepare('SELECT id FROM models WHERE id=?').get(id)) this.remove(id);
        },
      };
    } catch (error) {
      await fs.promises.rm(staged, { force: true });
      throw error;
    }
  }
  private async hash(file: string, signal: AbortSignal): Promise<string> {
    noLinks(file);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 256 * 1024, signal }))
      hash.update(chunk);
    return hash.digest('hex');
  }
  remove(id: string): void {
    fs.rmSync(this.directory(id), { recursive: true, force: true });
  }

  /**
   * A crash after catalog deletion can leave files behind. Only absent model IDs
   * are removed; another process may still be staging a live model's generation.
   */
  recoverDeletedModels(): void {
    if (!fs.existsSync(this.root)) return;
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue;
      if (!this.db.sql.prepare('SELECT id FROM models WHERE id=?').get(entry.name))
        this.remove(entry.name);
    }
  }
}
