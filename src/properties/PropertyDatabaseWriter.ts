import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fail } from '../domain/ModelsError.js';
import { propertyInput, propertyIdSchema, propertySetSchema, PROPERTY_LIMITS } from './schema.js';
import type { ModelPropertySet } from './types.js';

/**
 * Builds a private database in the conversion worker. Nothing is served until
 * finish succeeds and the parent publishes the file in a catalog transaction.
 */
export class PropertyDatabaseWriter {
  private readonly db: DatabaseSync;
  private closed = false;
  private propertySetCount = 0;
  private objectCount = 0;
  constructor(file: string, modelId: string, revision: string) {
    // The caller owns and checks the private staging directory. Exclusive creation
    // also rejects an existing file or symlink without traversing outside the worker.
    if (fs.existsSync(file)) fail('CONFLICT', 'Properties: staging database already exists');
    fs.closeSync(fs.openSync(file, 'wx', 0o600));
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=DELETE;
      PRAGMA synchronous=FULL;
      CREATE TABLE info(model_id TEXT NOT NULL,revision TEXT NOT NULL,property_set_count INTEGER NOT NULL,object_count INTEGER NOT NULL,complete INTEGER NOT NULL);
      CREATE TABLE property_sets(id TEXT PRIMARY KEY,name TEXT NOT NULL,json TEXT NOT NULL,bytes INTEGER NOT NULL);
      CREATE INDEX set_names ON property_sets(name,id);
      CREATE TABLE objects(id TEXT PRIMARY KEY);
      CREATE TABLE object_sets(object_id TEXT NOT NULL REFERENCES objects(id),
        ordinal INTEGER NOT NULL,set_id TEXT NOT NULL REFERENCES property_sets(id) DEFERRABLE INITIALLY DEFERRED,
        PRIMARY KEY(object_id,ordinal));
      CREATE INDEX set_objects ON object_sets(set_id,object_id);
      CREATE TABLE property_values(set_id TEXT NOT NULL REFERENCES property_sets(id),
        name TEXT NOT NULL,value_json TEXT NOT NULL);
      CREATE INDEX property_lookup ON property_values(name,value_json,set_id);
      PRAGMA user_version=1;
      BEGIN;
    `);
    this.db.prepare('INSERT INTO info VALUES(?,?,0,0,0)').run(modelId, revision);
  }
  addSet(input: ModelPropertySet): void {
    const set = propertyInput(propertySetSchema, input);
    const json = JSON.stringify(set);
    const bytes = Buffer.byteLength(json);
    if (bytes > PROPERTY_LIMITS.setBytes)
      fail('PROPERTY_SET_TOO_LARGE', 'Properties: one property set exceeds 4 MiB');
    const existing = this.db.prepare('SELECT json FROM property_sets WHERE id=?').get(set.id);
    if (existing) {
      if (existing.json !== json) fail('CONFLICT', 'Properties: conflicting shared set ' + set.id);
      return;
    }
    this.db.prepare('INSERT INTO property_sets VALUES(?,?,?,?)').run(set.id, set.name, json, bytes);
    this.propertySetCount++;
    const insert = this.db.prepare('INSERT INTO property_values VALUES(?,?,?)');
    for (const property of set.properties) {
      // Equality search is typed: the number 2 and the string "2" have different keys.
      const value = JSON.stringify(property.value);
      if (value === undefined) fail('INVALID_MODEL', 'Properties: a property has no JSON value');
      // Only scalar equality is exposed by the query API. Large strings and nested
      // values stay intact in the native JSON without duplicating them in an index.
      if (
        (property.value === null ||
          ['string', 'number', 'boolean'].includes(typeof property.value)) &&
        value.length <= 8192
      )
        insert.run(set.id, property.name, value);
    }
  }
  addObject(id: string, propertySetIds: readonly string[]): void {
    propertyInput(propertyIdSchema, id);
    this.db.prepare('INSERT INTO objects VALUES(?)').run(id);
    this.objectCount++;
    const insert = this.db.prepare('INSERT INTO object_sets VALUES(?,?,?)');
    propertySetIds.forEach((setId, ordinal) => {
      propertyInput(propertyIdSchema, setId);
      insert.run(id, ordinal, setId);
    });
  }
  async writeObject(id: string, sets: readonly ModelPropertySet[]): Promise<void> {
    for (const set of sets) this.addSet(set);
    this.addObject(
      id,
      sets.map((set) => set.id),
    );
  }
  finish(): void {
    if (this.closed) return;
    try {
      this.db.exec('COMMIT; PRAGMA optimize;');
      // Expensive verification stays in the resource-limited conversion worker.
      if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
        fail('DATABASE_ERROR', 'Properties: staged database failed integrity verification');
      this.db
        .prepare('UPDATE info SET property_set_count=?,object_count=?,complete=1')
        .run(this.propertySetCount, this.objectCount);
    } finally {
      this.db.close();
      this.closed = true;
    }
  }
  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }
}
