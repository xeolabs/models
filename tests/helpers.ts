import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../src/storage/PostgresDatabase.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
export const gltf = Buffer.from(
  JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] }),
);
export const png = Buffer.from('89504e470d0a1a0a', 'hex');
export async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-test-')),
    directory = path.join(root, 'library'),
    source = path.join(root, 'source');
  fs.mkdirSync(source);
  const connectionString = process.env.MODELS_TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      'Tests require MODELS_TEST_DATABASE_URL pointing to a disposable PostgreSQL server',
    );
  process.env.MODELS_DATABASE_URL = connectionString;
  const database = { connectionString, schema: 'test_' + randomUUID().replaceAll('-', '') };
  const library = await ModelsLibrary.open({ root: directory, create: true, database });
  return {
    root,
    directory,
    source,
    library,
    async close() {
      await library.close();
      const admin = new PostgresDatabase(directory, database);
      try {
        await admin.query(`DROP SCHEMA "${database.schema}" CASCADE`);
      } finally {
        await admin.close();
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
