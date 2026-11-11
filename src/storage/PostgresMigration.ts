import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { PostgresDatabase, type PostgresOptions } from './PostgresDatabase.js';
import { postgresSchema } from './postgresSchema.js';
import { noLinks } from './paths.js';
import { fail, wrap } from '../domain/ModelsError.js';
import { hashFile } from './hashFile.js';

const catalogTables = [
  'library_info',
  'models',
  'assets',
  'model_files',
  'tags',
  'model_tags',
  'acquisition_plans',
  'acquisition_plan_items',
  'acquisition_jobs',
  'acquisition_job_items',
  'model_acquisitions',
  'provider_cache',
  'processing_settings',
  'processing_jobs',
  'model_properties',
] as const;

/**
 * Copy a stopped SQLite catalog into an empty PostgreSQL schema. The source is
 * opened read-only and held at one snapshot. Geometry files are never copied.
 * Failure rolls back the target schema together with all imported rows.
 */
export async function migrateSqliteLibrary(options: { root: string; database: PostgresOptions }) {
  try {
    return await migrate(options);
  } catch (error) {
    throw wrap(error, 'Migrate SQLite library');
  }
}

async function migrate(options: { root: string; database: PostgresOptions }) {
  const root = path.resolve(options.root);
  const sourceFile = path.join(root, 'models.db');
  noLinks(sourceFile);
  if (!fs.existsSync(sourceFile)) fail('LIBRARY_NOT_FOUND', 'Migration: models.db is missing');
  let source: DatabaseSync | undefined;
  const target = new PostgresDatabase(root, options.database);
  const counts: Record<string, number> = {};
  try {
    source = new DatabaseSync(sourceFile, { readOnly: true });
    const catalog = source;
    source.exec('BEGIN');
    if (source.prepare('PRAGMA user_version').get()?.user_version !== 3)
      fail('UNSUPPORTED_SCHEMA', 'Migration: first upgrade the SQLite library to schema 3');
    if (
      source.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
      source.prepare('PRAGMA foreign_key_check').all().length
    )
      fail('DATABASE_ERROR', 'Migration: SQLite integrity verification failed');
    if (
      source
        .prepare("SELECT id FROM processing_jobs WHERE status IN ('running','cancelling') LIMIT 1")
        .get() ||
      source.prepare("SELECT id FROM acquisition_jobs WHERE status='running' LIMIT 1").get()
    )
      fail('JOB_CONFLICT', 'Migration: stop processing and acquisition jobs first');
    // Hash source databases before opening the target transaction. Large source
    // files must not occupy an idle PostgreSQL transaction during disk reads.
    const propertySources = new Map<string, { file: string; hash: string }>();
    for (const row of source
      .prepare('SELECT * FROM model_properties WHERE revision IS NOT NULL')
      .iterate()) {
      const id = String(row.model_id),
        revision = String(row.revision);
      if (
        !/^[a-f0-9-]{36}$/.test(id) ||
        !/^[a-f0-9]{64}$/.test(revision) ||
        row.file_name !== revision + '.db'
      )
        fail('INVALID_LIBRARY', 'Migration: invalid property registration');
      const file = path.join(root, 'properties', id, revision + '.db');
      propertySources.set(id, { file, hash: await hashFile(file) });
    }
    await target.transaction(async () => {
      await target.lock('schema-migration');
      if (await target.one('SELECT oid FROM pg_namespace WHERE nspname=$1', [target.schema]))
        fail('LIBRARY_ALREADY_EXISTS', 'Migration: target schema must not already exist');
      await target.query(`CREATE SCHEMA "${target.schema}"`);
      await target.query(postgresSchema);
      await target.query('DELETE FROM processing_settings');
      for (const table of catalogTables) {
        counts[table] = await copyRows(
          target,
          table,
          catalog.prepare(`SELECT * FROM "${table}"`).iterate(),
        );
        const copied = await target.one(`SELECT count(*) n FROM "${table}"`);
        if (Number(copied?.n) !== counts[table])
          fail('DATABASE_ERROR', 'Migration: row count mismatch for ' + table);
      }
      await target.query(`INSERT INTO model_search(id,name,description,tags,provider,format)
        SELECT m.id,m.name,m.description,COALESCE((SELECT string_agg(tag,' ' ORDER BY tag) FROM model_tags WHERE model_id=m.id),''),COALESCE(m.source_json::json->>'provider',''),COALESCE(m.format,'') FROM models m`);
      for (const row of catalog
        .prepare('SELECT * FROM model_properties WHERE revision IS NOT NULL')
        .iterate()) {
        const modelId = String(row.model_id),
          revision = String(row.revision);
        const { file, hash } = propertySources.get(modelId)!;
        const properties = new DatabaseSync(file, { readOnly: true });
        try {
          const info = properties.prepare('SELECT * FROM info').get();
          if (
            info?.model_id !== modelId ||
            info.revision !== revision ||
            info.complete !== 1 ||
            info.property_set_count !== row.property_set_count ||
            info.object_count !== row.object_count ||
            properties.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
            properties.prepare('PRAGMA foreign_key_check').all().length
          )
            fail('DATABASE_ERROR', 'Migration: invalid property generation');
          await target.query(
            'INSERT INTO property_generations(model_id,revision,property_set_count,object_count,source_hash) VALUES($1,$2,$3,$4,$5)',
            [modelId, revision, info.property_set_count, info.object_count, hash],
          );
          for (const [from, to] of [
            ['property_sets', 'property_sets'],
            ['objects', 'property_objects'],
            ['object_sets', 'object_sets'],
            ['property_values', 'property_values'],
          ]) {
            const n = await copyRows(
              target,
              to,
              properties.prepare(`SELECT * FROM "${from}"`).iterate(),
              { model_id: modelId, revision },
            );
            counts[to] = (counts[to] ?? 0) + n;
            if (
              (from === 'property_sets' && n !== Number(info.property_set_count)) ||
              (from === 'objects' && n !== Number(info.object_count))
            )
              fail('DATABASE_ERROR', 'Migration: property counts differ from registration');
          }
          await target.query(
            'UPDATE property_generations SET complete=true WHERE model_id=$1 AND revision=$2',
            [modelId, revision],
          );
        } finally {
          properties.close();
        }
      }
      // Force deferred property associations to validate before reporting success.
      await target.query('SET CONSTRAINTS ALL IMMEDIATE');
    });
    return {
      libraryId: String(source.prepare('SELECT id FROM library_info').get()!.id),
      schema: target.schema,
      counts,
    };
  } finally {
    source?.close();
    await target.close();
  }
}

/**
 * Bound both row count and encoded bytes, including unusually large property sets.
 * Values remain parameters; table and column names come from the known schema.
 */
export async function copyRows(
  db: PostgresDatabase,
  table: string,
  rows: Iterable<Record<string, unknown>>,
  prefix: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  let batch: Record<string, unknown>[] = [],
    bytes = 0,
    count = 0;
  const flush = async () => {
    signal?.throwIfAborted();
    if (!batch.length) return;
    const columns = Object.keys(batch[0]);
    if (![table, ...columns].every((name) => /^[a-z_]+$/.test(name)))
      fail('INVALID_LIBRARY', 'Migration: unexpected SQL identifier');
    const values = batch.flatMap((row) => columns.map((column) => row[column]));
    const tuples = batch
      .map(
        (_, row) =>
          '(' +
          columns.map((_, column) => '$' + (row * columns.length + column + 1)).join(',') +
          ')',
      )
      .join(',');
    const written = await db.all(
      `INSERT INTO "${table}" (${columns.map((c) => '"' + c + '"').join(',')}) VALUES ${tuples} RETURNING *`,
      values,
    );
    if (
      written.length !== batch.length ||
      written.some((row, index) => columns.some((column) => row[column] !== batch[index][column]))
    )
      fail('DATABASE_ERROR', 'Migration: stored values differ from the source');
    count += batch.length;
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const value = { ...prefix, ...row };
    const size = Buffer.byteLength(JSON.stringify(value));
    if (batch.length && (batch.length >= 250 || bytes + size > 4 * 1024 ** 2)) await flush();
    batch.push(value);
    bytes += size;
  }
  await flush();
  return count;
}
