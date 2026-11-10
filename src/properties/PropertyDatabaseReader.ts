import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import { PROPERTY_LIMITS } from './schema.js';
import type {
  ModelPropertySet,
  ObjectPropertiesQuery,
  ObjectPropertiesPage,
  PropertySetQuery,
  PropertySetPage,
  PropertyObjectQuery,
  PropertyObjectPage,
} from './types.js';

/**
 * Opens a published database read-only for a bounded query, then closes it.
 * No long-lived connection prevents a deleted model's files from being removed.
 */
export class PropertyDatabaseReader {
  constructor(
    private readonly file: string,
    readonly revision: string,
  ) {}
  private read<T>(work: (db: DatabaseSync) => T): T {
    noLinks(this.file);
    const db = new DatabaseSync(this.file, { readOnly: true });
    try {
      if (
        db.prepare('PRAGMA user_version').get()?.user_version !== 1 ||
        db.prepare('SELECT revision FROM info').get()?.revision !== this.revision
      )
        fail('DATABASE_ERROR', 'Properties: database generation does not match its registration');
      return work(db);
    } finally {
      db.close();
    }
  }
  sets(query: PropertySetQuery): PropertySetPage {
    return this.read((db) => {
      const ids = [...new Set(query.ids)];
      const start = query.cursor ?? 0;
      if (start > ids.length)
        fail('INVALID_PROPERTY_QUERY', 'Properties: cursor is outside this request');
      const result: PropertySetPage = { revision: this.revision, propertySets: [], missingIds: [] };
      let bytes = 0;
      const select = db.prepare('SELECT json,bytes FROM property_sets WHERE id=?');
      for (let i = start; i < ids.length; i++) {
        const row = select.get(ids[i]);
        if (!row) {
          result.missingIds.push(ids[i]);
          continue;
        }
        if (bytes + Number(row.bytes) > PROPERTY_LIMITS.responseBytes) {
          result.nextCursor = i;
          break;
        }
        bytes += Number(row.bytes);
        result.propertySets.push(JSON.parse(row.json as string) as ModelPropertySet);
      }
      return result;
    });
  }
  objects(query: ObjectPropertiesQuery): ObjectPropertiesPage {
    return this.read((db) => {
      const ids = [...new Set(query.objectIds)];
      const identity = createHash('sha256')
        .update(JSON.stringify([this.revision, ids]))
        .digest('hex');
      let index = 0,
        ordinal = 0;
      if (query.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
          if (
            cursor.key !== identity ||
            !Number.isSafeInteger(cursor.index) ||
            cursor.index < 0 ||
            cursor.index >= ids.length ||
            !Number.isSafeInteger(cursor.ordinal) ||
            cursor.ordinal < 0
          )
            throw new Error();
          index = cursor.index;
          ordinal = cursor.ordinal;
        } catch {
          fail('INVALID_PROPERTY_QUERY', 'Properties: invalid association cursor');
        }
      }
      const result: ObjectPropertiesPage = {
        revision: this.revision,
        objects: [],
        missingObjectIds: [],
      };
      let count = 0;
      for (; index < ids.length; index++, ordinal = 0) {
        const id = ids[index];
        if (!db.prepare('SELECT id FROM objects WHERE id=?').get(id)) {
          result.missingObjectIds.push(id);
          continue;
        }
        const remaining = PROPERTY_LIMITS.references - count;
        const rows = db
          .prepare(
            'SELECT set_id FROM object_sets WHERE object_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?',
          )
          .all(id, ordinal, remaining + 1);
        const taken = rows.slice(0, remaining);
        result.objects.push({ id, propertySetIds: taken.map((row) => row.set_id as string) });
        count += taken.length;
        if (rows.length > remaining) {
          result.nextCursor = Buffer.from(
            JSON.stringify({ key: identity, index, ordinal: ordinal + taken.length }),
          ).toString('base64url');
          break;
        }
      }
      return result;
    });
  }
  queryObjects(query: PropertyObjectQuery): PropertyObjectPage {
    return this.read((db) => {
      const limit = query.limit ?? 100;
      const rows = db
        .prepare(
          `SELECT DISTINCT refs.object_id id FROM property_values p
        JOIN property_sets sets ON sets.id=p.set_id JOIN object_sets refs ON refs.set_id=p.set_id
        WHERE p.name=? AND p.value_json=? AND refs.object_id>?
        ${query.propertySetName === undefined ? '' : 'AND sets.name=?'} ORDER BY refs.object_id LIMIT ?`,
        )
        .all(
          query.propertyName,
          JSON.stringify(query.value),
          query.after ?? '',
          ...(query.propertySetName === undefined ? [] : [query.propertySetName]),
          limit + 1,
        );
      const objectIds = rows.slice(0, limit).map((row) => row.id as string);
      return {
        revision: this.revision,
        objectIds,
        ...(rows.length > limit ? { nextCursor: objectIds.at(-1) } : {}),
      };
    });
  }
}
