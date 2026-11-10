import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './helpers.js';
import { Database } from '../src/storage/Database.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { ModelPropertyStore } from '../src/properties/ModelPropertyStore.js';
import { PropertyDatabaseWriter } from '../src/properties/PropertyDatabaseWriter.js';
import { PropertyDatabaseReader } from '../src/properties/PropertyDatabaseReader.js';
import { DataModelPropertyFile } from '../tools/DataModelPropertyFile.js';
import { readPropertyResponse } from '../src/browser/readPropertyResponse.js';

const revision = 'a'.repeat(64);
const set = {
  id: 'set',
  name: 'Test',
  type: 'IfcPropertySet',
  properties: [{ name: 'value', value: 1 }],
};

test('a version-2 catalog upgrades without changing models or originals', async () => {
  const f = await fixture();
  try {
    const model = await f.library.create({ metadata: { name: 'Existing' } });
    await f.library.close();
    const old = new DatabaseSync(path.join(f.directory, 'models.db'));
    old.exec('DROP TABLE model_properties; PRAGMA user_version=2;');
    old.close();
    const reopened = await ModelsLibrary.open({ root: f.directory });
    try {
      expect((await reopened.get(model.id))?.metadata.name).toBe('Existing');
      expect(await reopened.propertiesInfo(model.id)).toEqual({
        modelId: model.id,
        mode: 'embedded',
        ready: false,
      });
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
});

test('invalid, mismatched, cancelled and late publications never register a property database', async () => {
  const f = await fixture(),
    db = new Database(f.directory),
    store = new ModelPropertyStore(db);
  try {
    const model = await f.library.create({ metadata: { name: 'Transient' } });
    store.setMode(model.id, 'external');
    const file = path.join(f.root, 'stage.db');
    const writer = new PropertyDatabaseWriter(file, model.id, revision);
    writer.addSet(set);
    writer.addObject('object', [set.id]);
    writer.finish();
    await expect(
      store.prepareInstall(model.id, 'b'.repeat(64), file, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'DATABASE_ERROR' });
    await expect(
      store.prepareInstall(model.id, revision, file, AbortSignal.abort()),
    ).rejects.toMatchObject({ code: 'CONVERSION_CANCELLED' });
    const installation = await store.prepareInstall(
      model.id,
      revision,
      file,
      new AbortController().signal,
    );
    await f.library.delete(model.id);
    expect(() => db.transaction(() => installation.commit())).toThrow('model does not exist');
    await installation.cleanup();
    expect(fs.existsSync(path.join(f.directory, 'properties', model.id))).toBe(false);
    const broken = new PropertyDatabaseWriter(path.join(f.root, 'broken.db'), model.id, revision);
    broken.addObject('dangling', ['unknown']);
    expect(() => broken.finish()).toThrow();
    const symlink = path.join(f.root, 'link.db');
    fs.symlinkSync(file, symlink);
    expect(() => new PropertyDatabaseWriter(symlink, model.id, revision)).toThrow('already exists');
  } finally {
    db.sql.close();
    await f.close();
  }
});

test('large batches paginate by bytes, association cursors are bound to their request, and indexes preserve types', async () => {
  const f = await fixture();
  const file = path.join(f.root, 'large.db');
  const writer = new PropertyDatabaseWriter(file, 'model', revision);
  try {
    for (let i = 0; i < 3; i++)
      writer.addSet({
        ...set,
        id: 'set-' + i,
        properties: [{ name: 'text', value: 'x'.repeat(3 * 1024 ** 2) }],
      });
    writer.addObject('many', Array(2500).fill('set-0'));
    writer.finish();
    const reader = new PropertyDatabaseReader(file, revision);
    const first = reader.sets({ revision, ids: ['set-0', 'set-1', 'set-2'] });
    expect(first.propertySets).toHaveLength(2);
    expect(first.nextCursor).toBe(2);
    expect(
      reader.sets({ revision, ids: ['set-0', 'set-1', 'set-2'], cursor: first.nextCursor })
        .propertySets,
    ).toHaveLength(1);
    const associations = reader.objects({ revision, objectIds: ['many'] });
    expect(associations.objects[0].propertySetIds).toHaveLength(2048);
    expect(
      reader.objects({ revision, objectIds: ['many'], cursor: associations.nextCursor }).objects[0]
        .propertySetIds,
    ).toHaveLength(452);
    expect(() =>
      reader.objects({ revision, objectIds: ['other'], cursor: associations.nextCursor }),
    ).toThrow('cursor');
    expect(() =>
      new PropertyDatabaseReader(file, 'b'.repeat(64)).sets({ revision, ids: ['set-0'] }),
    ).toThrow('generation');
  } finally {
    writer.close();
    await f.close();
  }
});

test('the browser refuses oversized decompressed responses and invalid JSON', async () => {
  await expect(
    readPropertyResponse(new Response('x'.repeat(9 * 1024 ** 2 + 1))),
  ).rejects.toMatchObject({ code: 'PROPERTY_SET_TOO_LARGE' });
  await expect(readPropertyResponse(new Response('{invalid'))).rejects.toMatchObject({
    code: 'INVALID_PROPERTY_QUERY',
  });
});

test('a failed source stream rejects without leaving an active parser', async () => {
  const f = await fixture();
  const writer = new PropertyDatabaseWriter(path.join(f.root, 'stream.db'), 'model', revision);
  try {
    await expect(
      DataModelPropertyFile.externalize(
        path.join(f.root, 'missing.json'),
        path.join(f.root, 'thin.json'),
        writer,
        revision,
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const invalid = path.join(f.root, 'invalid.json');
    fs.writeFileSync(invalid, '{"propertySets":[{"id":');
    await expect(
      DataModelPropertyFile.externalize(
        invalid,
        path.join(f.root, 'invalid-output.json'),
        writer,
        revision,
      ),
    ).rejects.toThrow();
  } finally {
    writer.close();
    await f.close();
  }
});
