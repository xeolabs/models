import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hashFile } from '../storage/hashFile.js';
import { DatabaseSync } from 'node:sqlite';
import { Database } from '../storage/Database.js';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { PropertyDatabaseReader } from './PropertyDatabaseReader.js';
import { PropertyDatabaseWriter } from './PropertyDatabaseWriter.js';
import { propertyInput, propertyModeSchema, propertyRevisionSchema } from './schema.js';
import type { ModelPropertiesInfo, PropertySetMode, ModelPropertySet } from './types.js';
import { copyRows } from '../storage/PostgresMigration.js';

/**
 * PostgreSQL owns published properties. SQLite files are private worker exchange
 * artifacts and may be discarded without losing registered property values.
 */
export class ModelPropertyStore {
  constructor(private readonly db: Database) {}
  async initialize(id: string, mode: PropertySetMode): Promise<void> {
    propertyInput(propertyModeSchema, mode);
    await this.db.query('INSERT INTO model_properties(model_id,mode) VALUES($1,$2)', [id, mode]);
  }
  async info(id: string): Promise<ModelPropertiesInfo> {
    const row = await this.db.one(
      `SELECT p.*,g.complete FROM model_properties p LEFT JOIN property_generations g ON g.model_id=p.model_id AND g.revision=p.revision WHERE p.model_id=$1`,
      [id],
    );
    if (!row) fail('MODEL_NOT_FOUND', 'Properties: model does not exist');
    const ready = row.mode === 'external' && row.complete === true;
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
  async setMode(id: string, mode: PropertySetMode): Promise<void> {
    propertyInput(propertyModeSchema, mode);
    await this.info(id);
    await this.db.query('UPDATE model_properties SET mode=$1 WHERE model_id=$2', [mode, id]);
  }
  reader(id: string, revision: string): PropertyDatabaseReader {
    propertyInput(propertyRevisionSchema, revision);
    return new PropertyDatabaseReader(this.db, id, revision);
  }

  /**
   * Stream a registered generation into a private worker file. It is rebuilt from
   * PostgreSQL so a stale backup can never become the authority for an export.
   */
  async file(
    id: string,
    revision: string,
    directory: string,
    signal?: AbortSignal,
  ): Promise<string> {
    propertyInput(propertyRevisionSchema, revision);
    propertyInput(z.string().uuid(), id);
    noLinks(directory);
    await fs.promises.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'properties.db');
    const writer = new PropertyDatabaseWriter(file, id, revision);
    try {
      // Completed generations are immutable. Read without a long row lock so
      // cancellation and deletion remain available during very large exports.
      await this.assertGeneration(id, revision);
      let after: Buffer = Buffer.alloc(0);
      for (;;) {
        signal?.throwIfAborted();
        const rows = await this.db.all(
          'SELECT id,id_key,json FROM property_sets WHERE model_id=$1 AND revision=$2 AND id_key>$3 ORDER BY id_key LIMIT 16',
          [id, revision, after],
        );
        if (!rows.length) break;
        for (const row of rows) writer.addSet(JSON.parse(row.json as string) as ModelPropertySet);
        after = rows.at(-1)!.id_key as Buffer;
      }
      after = Buffer.alloc(0);
      for (;;) {
        signal?.throwIfAborted();
        const rows = await this.db.all(
          `SELECT o.id,o.id_key,
            ARRAY(SELECT r.set_id FROM object_sets r WHERE r.model_id=o.model_id
              AND r.revision=o.revision AND r.object_key=o.id_key AND r.object_id=o.id ORDER BY r.ordinal) refs
           FROM property_objects o WHERE model_id=$1 AND revision=$2 AND id_key>$3 ORDER BY id_key LIMIT 128`,
          [id, revision, after],
        );
        if (!rows.length) break;
        for (const row of rows) writer.addObject(row.id as string, row.refs as string[]);
        after = rows.at(-1)!.id_key as Buffer;
      }
      signal?.throwIfAborted();
      await this.assertGeneration(id, revision);
      writer.finish();
      return file;
    } catch (error) {
      writer.close();
      await fs.promises.rm(file, { force: true });
      throw error;
    }
  }

  /**
   * Internal exports may reuse a completed external generation while switching
   * back to embedded mode. Public queries still require the current external mode.
   */
  private async assertGeneration(id: string, revision: string): Promise<void> {
    const row = await this.db.one(
      'SELECT complete FROM property_generations WHERE model_id=$1 AND revision=$2',
      [id, revision],
    );
    if (!row?.complete)
      fail('PROPERTIES_NOT_READY', 'Properties: completed generation is unavailable');
  }

  /**
   * Import a completed worker database before publication. Only commit() makes
   * the revision visible, inside the same transaction as the conversion result.
   */
  async prepareInstall(id: string, revision: string, source: string, signal: AbortSignal) {
    propertyInput(propertyRevisionSchema, revision);
    noLinks(source);
    if (signal.aborted) fail('CONVERSION_CANCELLED', 'Properties: publication cancelled');
    const sourceHash = await hashFile(source, signal);
    const stage = new DatabaseSync(source, { readOnly: true });
    let sets = 0,
      objects = 0;
    try {
      const info = stage.prepare('SELECT * FROM info').get();
      if (
        info?.model_id !== id ||
        info.revision !== revision ||
        info.complete !== 1 ||
        stage.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
        stage.prepare('PRAGMA foreign_key_check').all().length
      )
        fail('DATABASE_ERROR', 'Properties: invalid staged generation');
      sets = Number(info.property_set_count);
      objects = Number(info.object_count);
      const load = await this.db.transaction(async () => {
        await this.db.lock('model:' + id);
        if (signal.aborted) fail('CONVERSION_CANCELLED', 'Properties: publication cancelled');
        const existing = await this.db.one(
          'SELECT complete,source_hash FROM property_generations WHERE model_id=$1 AND revision=$2',
          [id, revision],
        );
        if (existing?.complete) {
          if (existing.source_hash !== sourceHash)
            fail('CONFLICT', 'Properties: this revision already has different contents');
          return false;
        }
        await this.db.query('DELETE FROM property_generations WHERE model_id=$1 AND revision=$2', [
          id,
          revision,
        ]);
        await this.db.query(
          'INSERT INTO property_generations(model_id,revision,property_set_count,object_count,source_hash) VALUES($1,$2,$3,$4,$5)',
          [id, revision, sets, objects, sourceHash],
        );
        return true;
      });
      if (load) {
        for (const [from, to] of [
          ['property_sets', 'property_sets'],
          ['objects', 'property_objects'],
          ['object_sets', 'object_sets'],
          ['property_values', 'property_values'],
        ]) {
          if (signal.aborted) fail('CONVERSION_CANCELLED', 'Properties: publication cancelled');
          const count = await copyRows(
            this.db,
            to,
            stage.prepare(`SELECT * FROM "${from}"`).iterate(),
            { model_id: id, revision },
            signal,
          );
          if (
            (from === 'property_sets' && count !== sets) ||
            (from === 'objects' && count !== objects)
          )
            fail('DATABASE_ERROR', 'Properties: staged counts differ from registered counts');
        }
        if (signal.aborted) fail('CONVERSION_CANCELLED', 'Properties: publication cancelled');
      }
    } catch (error) {
      await this.db
        .query(
          'DELETE FROM property_generations WHERE model_id=$1 AND revision=$2 AND source_hash=$3 AND NOT complete',
          [id, revision, sourceHash],
        )
        .catch(() => {});
      throw error;
    } finally {
      stage.close();
    }
    return {
      commit: async () => {
        await this.db.lock('model:' + id);
        if (signal.aborted) fail('CONVERSION_CANCELLED', 'Properties: publication cancelled');
        if ((await this.info(id)).mode !== 'external')
          fail('CONFLICT', 'Properties: storage mode changed');
        await this.db.query(
          'UPDATE property_generations SET complete=true WHERE model_id=$1 AND revision=$2',
          [id, revision],
        );
        await this.db.query(
          'UPDATE model_properties SET revision=$1,file_name=$2,property_set_count=$3,object_count=$4 WHERE model_id=$5',
          [revision, revision + '.db', sets, objects, id],
        );
      },
      cleanup: async () => {
        await this.db.query(
          'DELETE FROM property_generations g WHERE model_id=$1 AND revision=$2 AND NOT complete AND NOT EXISTS(SELECT 1 FROM model_properties p WHERE p.model_id=g.model_id AND p.revision=g.revision)',
          [id, revision],
        );
      },
    };
  }

  /**
   * Property rows are removed by foreign keys. Remove disposable worker exports.
   */
  async remove(id: string): Promise<void> {
    propertyInput(z.string().uuid(), id);
    const directory = path.join(this.db.root, '.cache', 'property-exchange', id);
    noLinks(directory);
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}
