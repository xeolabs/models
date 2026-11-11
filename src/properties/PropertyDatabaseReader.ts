import { Database } from '../storage/Database.js';
import { createHash } from 'node:crypto';
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
 * Reads a bounded page from the current PostgreSQL property generation.
 * Model and revision filters prevent values leaking between models.
 */
export class PropertyDatabaseReader {
  constructor(
    private readonly db: Database,
    private readonly modelId: string,
    readonly revision: string,
  ) {}

  /**
   * Keep publication and deletion outside this bounded read transaction.
   */
  async assertCurrent(): Promise<void> {
    const row = await this.db.one(
      'SELECT p.mode,p.revision,g.complete FROM model_properties p LEFT JOIN property_generations g ON g.model_id=p.model_id AND g.revision=p.revision WHERE p.model_id=$1 FOR SHARE OF p',
      [this.modelId],
    );
    if (!row) fail('MODEL_NOT_FOUND', 'Properties: model does not exist');
    if (row.mode !== 'external' || !row.complete)
      fail('PROPERTIES_NOT_READY', 'Properties: prepare this model first');
    if (row.revision !== this.revision)
      fail(
        'PROPERTY_REVISION_MISMATCH',
        'Properties: reload the model before requesting a different revision',
      );
  }
  private async read<T>(work: (db: Database) => Promise<T>): Promise<T> {
    return this.db.transaction(async () => {
      await this.assertCurrent();
      return work(this.db);
    });
  }
  async sets(query: PropertySetQuery): Promise<PropertySetPage> {
    return this.read(async (db) => {
      const ids = [...new Set(query.ids)];
      const start = query.cursor ?? 0;
      if (start > ids.length)
        fail('INVALID_PROPERTY_QUERY', 'Properties: cursor is outside this request');
      const result: PropertySetPage = { revision: this.revision, propertySets: [], missingIds: [] };
      let bytes = 0;

      // Read sizes first, then fetch only the JSON that fits this response.
      // A batch of 128 large sets must not allocate hundreds of megabytes.
      const sizes = await db.all(
        `SELECT id,bytes FROM property_sets WHERE model_id=$1 AND revision=$2
         AND id_key=ANY(SELECT property_key(value) FROM unnest($3::text[]) value)
         AND id=ANY($3::text[])`,
        [this.modelId, this.revision, ids.slice(start)],
      );
      const byId = new Map(sizes.map((row) => [row.id as string, Number(row.bytes)]));
      const selected: string[] = [];
      for (let i = start; i < ids.length; i++) {
        const size = byId.get(ids[i]);
        if (size === undefined) {
          result.missingIds.push(ids[i]);
          continue;
        }
        if (bytes + size > PROPERTY_LIMITS.responseBytes) {
          result.nextCursor = i;
          break;
        }
        bytes += size;
        selected.push(ids[i]);
      }
      if (selected.length) {
        const rows = await db.all(
          `SELECT id,json FROM property_sets WHERE model_id=$1 AND revision=$2
           AND id_key=ANY(SELECT property_key(value) FROM unnest($3::text[]) value)
           AND id=ANY($3::text[])`,
          [this.modelId, this.revision, selected],
        );
        const values = new Map(
          rows.map((row) => [row.id, JSON.parse(row.json as string) as ModelPropertySet]),
        );
        result.propertySets = selected.map((id) => values.get(id)!);
      }
      return result;
    });
  }
  async objects(query: ObjectPropertiesQuery): Promise<ObjectPropertiesPage> {
    return this.read(async (db) => {
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
        if (
          !(await db.one(
            'SELECT id FROM property_objects WHERE model_id=$1 AND revision=$2 AND id_key=property_key($3) AND id=$3',
            [this.modelId, this.revision, id],
          ))
        ) {
          result.missingObjectIds.push(id);
          continue;
        }
        const remaining = PROPERTY_LIMITS.references - count;
        const rows = await db.all(
          'SELECT set_id FROM object_sets WHERE model_id=$1 AND revision=$2 AND object_key=property_key($3) AND object_id=$3 AND ordinal>=$4 ORDER BY ordinal LIMIT $5',
          [this.modelId, this.revision, id, ordinal, remaining + 1],
        );
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
  async queryObjects(query: PropertyObjectQuery): Promise<PropertyObjectPage> {
    return this.read(async (db) => {
      const limit = query.limit ?? 100;
      const rows = await db.all(
        `SELECT DISTINCT refs.object_id id FROM property_values p
        JOIN property_sets sets ON (sets.model_id,sets.revision,sets.id_key)=(p.model_id,p.revision,p.set_key) AND sets.id=p.set_id
        JOIN object_sets refs ON (refs.model_id,refs.revision,refs.set_key)=(p.model_id,p.revision,p.set_key) AND refs.set_id=p.set_id
        WHERE p.model_id=$1 AND p.revision=$2 AND md5(p.name)=md5($3) AND p.name=$3 AND md5(p.value_json)=md5($4) AND p.value_json=$4 AND refs.object_id>$5
        AND ($6::text IS NULL OR sets.name=$6) ORDER BY refs.object_id LIMIT $7`,
        [
          this.modelId,
          this.revision,
          query.propertyName,
          JSON.stringify(query.value),
          query.after ?? '',
          query.propertySetName ?? null,
          limit + 1,
        ],
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
