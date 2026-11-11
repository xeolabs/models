import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { migrateSqliteLibrary } from '../src/storage/PostgresMigration.js';
import { PostgresDatabase } from '../src/storage/PostgresDatabase.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { PropertyDatabaseWriter } from '../src/properties/PropertyDatabaseWriter.js';
const connectionString = process.env.MODELS_TEST_DATABASE_URL;
const integration = test.skipIf(!connectionString);
integration(
  'migration preserves identities, exact properties and source files, and refuses an existing target',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-migration-'));
    const database = {
      connectionString: connectionString!,
      schema: 'test_' + randomUUID().replaceAll('-', ''),
    };
    const target = new PostgresDatabase(root, database),
      sourceFile = path.join(root, 'models.db');
    const modelId = randomUUID(),
      libraryId = randomUUID(),
      revision = 'a'.repeat(64),
      now = new Date().toISOString();
    const source = new DatabaseSync(sourceFile);
    source.exec(
      fs.readFileSync(new URL('./fixtures/legacy-sqlite-schema.sql', import.meta.url), 'utf8'),
    );
    source.prepare('INSERT INTO library_info VALUES(?,?)').run(libraryId, now);
    source
      .prepare('INSERT INTO models VALUES(?,?,?,?,?,?,?,?,?)')
      .run(modelId, 'Oak model', 'Preserved', '{}', null, null, '[]', now, now);
    source
      .prepare('INSERT INTO model_properties VALUES(?,?,?,?,?,?)')
      .run(modelId, 'external', revision, revision + '.db', 1, 1);
    source
      .prepare(
        `INSERT INTO processing_jobs(id,model_id,kind,format,status,source,phase,created_at,cpu_percent)
      VALUES(?,?,'convert','xgf','completed','requested','Completed',?,?)`,
      )
      .run(randomUUID(), modelId, now, 42.123456789);
    source.close();
    const directory = path.join(root, 'properties', modelId);
    fs.mkdirSync(directory, { recursive: true });
    const writer = new PropertyDatabaseWriter(
      path.join(directory, revision + '.db'),
      modelId,
      revision,
    );
    const set = {
      id: 'native-id',
      name: 'Original name',
      type: 'IfcPropertySet',
      properties: [
        { name: 'Height', value: 2 },
        { name: 'Unicode', value: 'Größe 🌍' },
      ],
    };
    await writer.writeObject('element', [set]);
    writer.finish();
    const hash = () => createHash('sha256').update(fs.readFileSync(sourceFile)).digest('hex');
    const before = hash();
    try {
      const report = await migrateSqliteLibrary({ root, database });
      expect(report.libraryId).toBe(libraryId);
      expect(report.counts.models).toBe(1);
      expect(report.counts.property_sets).toBe(1);
      expect((await target.one('SELECT cpu_percent FROM processing_jobs'))!.cpu_percent).toBe(
        42.123456789,
      );
      expect(hash()).toBe(before);
      expect(fs.existsSync(path.join(root, 'postgres.json'))).toBe(false);
      fs.writeFileSync(
        path.join(root, 'postgres.json'),
        JSON.stringify({ libraryId, schema: database.schema }),
      );
      const library = await ModelsLibrary.open({ root, database });
      try {
        expect((await library.get(modelId))?.createdAt).toBe(now);
        expect(
          (await library.getPropertySets(modelId, { revision, ids: [set.id] })).propertySets,
        ).toEqual([set]);
        expect((await library.search('oak'))[0].id).toBe(modelId);
      } finally {
        await library.close();
      }
      await expect(migrateSqliteLibrary({ root, database })).rejects.toMatchObject({
        code: 'LIBRARY_ALREADY_EXISTS',
      });
    } finally {
      await target.query(`DROP SCHEMA IF EXISTS "${database.schema}" CASCADE`);
      await target.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
integration('failed migration rolls back its schema and leaves the source unchanged', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-migration-failure-'));
  const database = {
    connectionString: connectionString!,
    schema: 'test_' + randomUUID().replaceAll('-', ''),
  };
  const target = new PostgresDatabase(root, database),
    source = new DatabaseSync(path.join(root, 'models.db'));
  source.exec(
    fs.readFileSync(new URL('./fixtures/legacy-sqlite-schema.sql', import.meta.url), 'utf8'),
  );
  const id = randomUUID(),
    revision = 'a'.repeat(64),
    now = new Date().toISOString();
  source.prepare('INSERT INTO library_info VALUES(?,?)').run(randomUUID(), now);
  source
    .prepare('INSERT INTO models VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, 'Missing properties', '', '{}', null, null, '[]', now, now);
  source
    .prepare('INSERT INTO model_properties VALUES(?,?,?,?,?,?)')
    .run(id, 'external', revision, revision + '.db', 1, 1);
  source.close();
  try {
    await expect(migrateSqliteLibrary({ root, database })).rejects.toBeDefined();
    expect(
      await target.one('SELECT oid FROM pg_namespace WHERE nspname=$1', [database.schema]),
    ).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'models.db'))).toBe(true);
  } finally {
    await target.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
