import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { Database } from '../src/storage/Database.js';
import { ModelPropertyStore } from '../src/properties/ModelPropertyStore.js';
import { PropertyDatabaseWriter } from '../src/properties/PropertyDatabaseWriter.js';
import { DataModelPropertyFile } from '../tools/DataModelPropertyFile.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';
import { acquisitionOptions } from './acquisition-helpers.js';

const revision = 'a'.repeat(64);
const set = {
  id: 'wall.pset',
  name: 'Pset_WallCommon',
  type: 'IfcPropertySet',
  properties: [
    { name: 'FireRating', value: '2h', description: 'Fire rating information. '.repeat(200) },
    { name: 'Height', value: 2 },
  ],
};
async function propertyFixture() {
  const f = await fixture();
  const model = await f.library.create({ metadata: { name: 'Property test' } });
  const db = new Database(f.directory);
  const store = new ModelPropertyStore(db);
  await store.setMode(model.id, 'external');
  const file = path.join(f.root, 'properties.db');
  const writer = new PropertyDatabaseWriter(file, model.id, revision);
  await writer.writeObject('wall', [set]);
  await writer.writeObject('wall-2', [set]);
  await writer.writeObject('empty', []);
  writer.finish();
  const installation = await store.prepareInstall(
    model.id,
    revision,
    file,
    new AbortController().signal,
  );
  await db.transaction(async () => await installation.commit());
  await installation.cleanup();
  return {
    ...f,
    model,
    db,
    store,
    async close() {
      await db.close();
      await f.close();
    },
  };
}

test('published sets retain native values, shared IDs, typed queries and missing/empty distinctions', async () => {
  const f = await propertyFixture();
  try {
    expect(await f.library.propertiesInfo(f.model.id)).toMatchObject({
      ready: true,
      revision,
      propertySetCount: 1,
      objectCount: 3,
    });
    expect(
      await f.library.getPropertySets(f.model.id, { revision, ids: [set.id, set.id, 'missing'] }),
    ).toEqual({ revision, propertySets: [set], missingIds: ['missing'] });
    expect(
      await f.library.getObjectProperties(f.model.id, {
        revision,
        objectIds: ['wall', 'wall-2', 'empty', 'missing'],
      }),
    ).toEqual({
      revision,
      objects: [
        { id: 'wall', propertySetIds: [set.id] },
        { id: 'wall-2', propertySetIds: [set.id] },
        { id: 'empty', propertySetIds: [] },
      ],
      missingObjectIds: ['missing'],
    });
    expect(
      await f.library.queryPropertyObjects(f.model.id, {
        revision,
        propertyName: 'Height',
        value: 2,
        limit: 1,
      }),
    ).toEqual({ revision, objectIds: ['wall'], nextCursor: 'wall' });
    expect(
      (
        await f.library.queryPropertyObjects(f.model.id, {
          revision,
          propertyName: 'Height',
          value: '2',
        })
      ).objectIds,
    ).toEqual([]);
    await expect(
      f.library.getPropertySets(f.model.id, { revision: 'b'.repeat(64), ids: [set.id] }),
    ).rejects.toMatchObject({ code: 'PROPERTY_REVISION_MISMATCH' });
    await expect(
      f.library.getPropertySets(f.model.id, { revision, ids: Array(129).fill(set.id) }),
    ).rejects.toMatchObject({ code: 'INVALID_PROPERTY_QUERY' });
    await f.library.delete(f.model.id);
    expect(fs.existsSync(path.join(f.directory, 'properties', f.model.id))).toBe(false);
    expect(await f.db.all('SELECT * FROM model_properties', [])).toEqual([]);
    await expect(
      f.library.getPropertySets(f.model.id, { revision, ids: [set.id] }),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  } finally {
    await f.close();
  }
});

test('streaming migration removes values, preserves IDs, and produces a complete offline export', async () => {
  const f = await fixture();
  const input = path.join(f.root, 'full.json'),
    output = path.join(f.root, 'thin.json'),
    database = path.join(f.root, 'properties.db');
  const native = {
    id: 'model',
    version: '1.0',
    propertySets: [set],
    objects: [{ id: 'wall', name: 'Wall', type: 'IfcWall', propertySetIds: [set.id] }],
    relationships: [],
    propertySetMode: 'embedded',
  };
  fs.writeFileSync(input, JSON.stringify(native));
  const writer = new PropertyDatabaseWriter(database, 'model', revision);
  try {
    await DataModelPropertyFile.externalize(input, output, writer, revision);
    writer.finish();
    const thin = JSON.parse(fs.readFileSync(output, 'utf8'));
    expect(thin).toEqual({
      ...native,
      propertySets: [],
      propertySetMode: 'external',
      revisionId: revision,
    });
    const complete = path.join(f.root, 'complete.json');
    await DataModelPropertyFile.embed(output, complete, database);
    expect(JSON.parse(fs.readFileSync(complete, 'utf8'))).toEqual({
      ...native,
      revisionId: revision,
    });
  } finally {
    writer.close();
    await f.close();
  }
});

test('trusted cross-origin viewers may query compressed properties but cannot change storage', async () => {
  const f = await propertyFixture();
  const origin = 'http://localhost:5173';
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    allowedOrigins: [origin],
    acquisition: acquisitionOptions(),
  });
  try {
    const route = server.url + '/api/models/' + f.model.id + '/property-sets/query';
    const preflight = await fetch(route, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(204);
    const response = await fetch(route, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, ids: [set.id] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect((await response.json()).data.propertySets).toEqual([set]);
    expect(
      (
        await fetch(server.url + '/api/models/' + f.model.id + '/properties', {
          method: 'PATCH',
          headers: {
            Origin: origin,
            'X-Models-Action': 'explicit',
            'Content-Type': 'application/json',
          },
          body: '{"mode":"embedded"}',
        })
      ).status,
    ).toBe(403);
    const client = await ServerModelsClient.open(server.url);
    expect(await client.getPropertySets(f.model.id, { revision, ids: [set.id] })).toEqual([set]);
    expect(await client.getPropertySets(f.model.id, { revision, ids: [set.id] })).toEqual([set]);
    await expect(
      client.getPropertySets(f.model.id, { revision, ids: ['missing'] }),
    ).rejects.toMatchObject({ code: 'PROPERTY_SET_NOT_FOUND' });
  } finally {
    await server.close();
    await f.close();
  }
});
