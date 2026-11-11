import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { PostgresDatabase } from '../src/storage/PostgresDatabase.js';
import { initializePostgres } from '../src/storage/PostgresCatalog.js';
import { PropertyDatabaseWriter } from '../src/properties/PropertyDatabaseWriter.js';
import { ModelPropertyStore } from '../src/properties/ModelPropertyStore.js';
import { Database } from '../src/storage/Database.js';

const connectionString = process.env.MODELS_TEST_DATABASE_URL;
const integration = test.skipIf(!connectionString);
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-pg-'));
  const options = {
    connectionString: connectionString!,
    schema: 'test_' + randomUUID().replaceAll('-', ''),
  };
  const library = await ModelsLibrary.open({ root, create: true, database: options });
  const db = new Database(root, options);
  return {
    root,
    library,
    db,
    async close() {
      await library.close();
      await db.query(`DROP SCHEMA "${options.schema}" CASCADE`);
      await db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

integration(
  'PostgreSQL catalog preserves CRUD, prefix search, tags, files and reopen identity',
  async () => {
    const f = await fixture();
    try {
      const model = await f.library.create({
        metadata: { name: 'Natural oak flooring', tags: ['WOOD'], source: { provider: 'example' } },
      });
      expect((await f.library.search('nat oak')).map((m) => m.id)).toEqual([model.id]);
      expect(await f.library.search({ tags: ['wood', 'absent'] })).toEqual([]);
      expect((await f.library.search({ provider: 'example' }))[0].id).toBe(model.id);
      await f.library.update(model.id, { metadata: { name: 'Polished concrete' } });
      expect(await f.library.search('oak')).toEqual([]);
      expect((await f.library.search('polished'))[0].id).toBe(model.id);
      const unicode = await f.library.create({ metadata: { name: 'Über façade 2048' } });
      expect((await f.library.search('ÜBER FAÇ 204'))[0].id).toBe(unicode.id);
      await f.library.delete(unicode.id);
      const file = path.join(f.root, 'fixture.gltf');
      fs.writeFileSync(file, JSON.stringify({ asset: { version: '2.0' }, scenes: [] }));
      const imported = (await f.library.importFile({ path: file })).model!;
      expect(imported.files[0].bytes).toBe(fs.statSync(file).size);
      expect(await f.library.resolveAsset(imported.files[0].assetId)).toContain(
        imported.files[0].assetId,
      );
      expect((await f.library.validate()).ok).toBe(true);
      await f.library.delete(model.id);
      expect(await f.library.get(model.id)).toBeNull();
      expect((await f.library.summary()).modelCount).toBe(1);
    } finally {
      await f.close();
    }
  },
);

integration(
  'PostgreSQL transactions roll back and isolate concurrent library operations',
  async () => {
    const f = await fixture();
    try {
      await expect(
        f.db.transaction(async () => {
          await f.db.query("INSERT INTO tags VALUES('rolled-back')");
          throw Error('stop');
        }),
      ).rejects.toThrow();
      expect(await f.db.one("SELECT * FROM tags WHERE name='rolled-back'")).toBeUndefined();
      await expect(
        f.db.transaction(async () => {
          try {
            await f.db.transaction(async () => {
              throw Error('nested');
            });
          } catch {}
        }),
      ).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
      const records = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          f.library.create({ metadata: { name: 'Model ' + i, tags: ['shared'] } }),
        ),
      );
      expect(new Set(records.map((m) => m.id)).size).toBe(6);
      expect((await f.library.listTags())[0]).toMatchObject({ name: 'shared', count: 6 });
    } finally {
      await f.close();
    }
  },
);

integration(
  'published properties are read from PostgreSQL and cascade with model deletion',
  async () => {
    const f = await fixture();
    try {
      const model = await f.library.create({ metadata: { name: 'Properties' } }),
        revision = 'a'.repeat(64);
      const store = new ModelPropertyStore(f.db);
      await store.setMode(model.id, 'external');
      const file = path.join(f.root, 'stage.db'),
        writer = new PropertyDatabaseWriter(file, model.id, revision);
      await writer.writeObject('wall', [
        {
          id: 'common',
          name: 'Pset_WallCommon',
          type: 'IfcPropertySet',
          properties: [{ name: 'Height', value: 2 }],
        },
      ]);
      await writer.writeObject('empty', []);
      writer.finish();
      const install = await store.prepareInstall(
        model.id,
        revision,
        file,
        new AbortController().signal,
      );
      expect((await store.info(model.id)).ready).toBe(false);
      await f.db.transaction(async () => await install.commit());
      await install.cleanup();
      fs.rmSync(file);
      expect(
        (await f.library.getPropertySets(model.id, { revision, ids: ['common'] })).propertySets[0]
          .properties[0].value,
      ).toBe(2);
      expect(
        (
          await f.library.queryPropertyObjects(model.id, {
            revision,
            propertyName: 'Height',
            value: 2,
          })
        ).objectIds,
      ).toEqual(['wall']);
      expect(
        (
          await f.library.queryPropertyObjects(model.id, {
            revision,
            propertyName: 'Height',
            value: '2',
          })
        ).objectIds,
      ).toEqual([]);
      expect(
        (
          await f.library.getObjectProperties(model.id, {
            revision,
            objectIds: ['empty', 'missing'],
          })
        ).missingObjectIds,
      ).toEqual(['missing']);
      await expect(
        f.library.getPropertySets(model.id, { revision: 'b'.repeat(64), ids: ['common'] }),
      ).rejects.toMatchObject({ code: 'PROPERTY_REVISION_MISMATCH' });
      await f.library.delete(model.id);
      expect((await f.db.one('SELECT count(*) n FROM property_sets'))!.n).toBe(0);
    } finally {
      await f.close();
    }
  },
);

integration('initialization rejects an unrelated schema without overwriting it', async () => {
  const schema = 'test_' + randomUUID().replaceAll('-', ''),
    db = new PostgresDatabase('/tmp', { connectionString: connectionString!, schema });
  try {
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query('CREATE TABLE unrelated(value TEXT)');
    await expect(initializePostgres(db, true)).rejects.toMatchObject({ code: 'INVALID_LIBRARY' });
    expect(await db.all('SELECT * FROM unrelated')).toEqual([]);
  } finally {
    await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.close();
  }
});

integration(
  'long external IDs, typed values and immutable published revisions survive PostgreSQL',
  async () => {
    const f = await fixture();
    try {
      const model = await f.library.create({ metadata: { name: 'Long external IDs' } });
      const store = new ModelPropertyStore(f.db);
      await store.setMode(model.id, 'external');
      const revision = 'b'.repeat(64);
      const id = Array.from(randomBytes(2048), (n) => String.fromCharCode(0x400 + n)).join('');
      const object = Array.from(randomBytes(2048), (n) => String.fromCharCode(0x800 + n)).join('');
      const set = {
        id,
        name: 'Common',
        type: 'IfcPropertySet',
        properties: [{ name: 'Value', value: 42 }],
      };
      const stage = path.join(f.root, 'large-id.db');
      const writer = new PropertyDatabaseWriter(stage, model.id, revision);
      await writer.writeObject(object, [set]);
      writer.finish();
      const install = await store.prepareInstall(
        model.id,
        revision,
        stage,
        new AbortController().signal,
      );
      await f.db.transaction(() => install.commit());
      await install.cleanup();
      expect(
        (await f.library.getPropertySets(model.id, { revision, ids: [id] })).propertySets,
      ).toEqual([set]);
      expect(
        (
          await f.library.queryPropertyObjects(model.id, {
            revision,
            propertyName: 'Value',
            value: 42,
          })
        ).objectIds,
      ).toEqual([object]);
      expect(
        (await f.library.getObjectProperties(model.id, { revision, objectIds: [object] }))
          .objects[0].propertySetIds,
      ).toEqual([id]);
      const alternate = path.join(f.root, 'conflict.db');
      const changed = new PropertyDatabaseWriter(alternate, model.id, revision);
      await changed.writeObject(object, [{ ...set, properties: [{ name: 'Value', value: 43 }] }]);
      changed.finish();
      await expect(
        store.prepareInstall(model.id, revision, alternate, new AbortController().signal),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(
        (await f.library.getPropertySets(model.id, { revision, ids: [id] })).propertySets,
      ).toEqual([set]);
    } finally {
      await f.close();
    }
  },
);

integration('concurrent imports, GC and tag edits preserve shared assets and updates', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'triangle.obj');
    fs.writeFileSync(file, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    const [a, b] = await Promise.all([
      f.library.importFile({ path: file }),
      f.library.importFile({ path: file }),
      f.library.gc({ dryRun: false }),
    ]);
    expect(a.model!.files[0].assetId).toBe(b.model!.files[0].assetId);
    await Promise.all([
      f.library.addTags(a.model!.id, ['one']),
      f.library.addTags(a.model!.id, ['two']),
    ]);
    expect((await f.library.get(a.model!.id))!.metadata.tags).toEqual(['one', 'two']);
    expect((await f.library.validate()).ok).toBe(true);
    await f.library.delete(a.model!.id);
    await f.library.gc({ dryRun: false });
    expect(fs.existsSync(await f.library.resolveAsset(b.model!.files[0].assetId))).toBe(true);
  } finally {
    await f.close();
  }
});

integration(
  'a lost transaction connection rolls back and the pool accepts later work',
  async () => {
    const f = await fixture();
    try {
      await expect(
        f.db.transaction(async () => {
          await f.db.query("INSERT INTO tags VALUES('lost-transaction')");
          await f.db.query('SELECT pg_terminate_backend(pg_backend_pid())');
        }),
      ).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
      expect(await f.db.one("SELECT * FROM tags WHERE name='lost-transaction'")).toBeUndefined();
      expect((await f.library.create({ metadata: { name: 'After reconnect' } })).id).toBeTruthy();
    } finally {
      await f.close();
    }
  },
);
