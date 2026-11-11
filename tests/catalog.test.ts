import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { Database } from '../src/storage/Database.js';
import { fixture, gltf } from './helpers.js';

test('CRUD keeps stable identities, transactional search and normalized tags', async () => {
  const f = await fixture();
  try {
    const oak = await f.library.create({
      metadata: {
        name: 'Oak chair',
        tags: [' Wood ', 'wood', 'Furniture'],
        source: { provider: 'local' },
      },
    });
    expect(oak.metadata.tags).toEqual(['furniture', 'wood']);
    expect((await f.library.search('oak'))[0].id).toBe(oak.id);
    const next = await f.library.update(oak.id, {
      metadata: { name: 'Pine chair', description: 'Office chair' },
    });
    expect(next.id).toBe(oak.id);
    expect(await f.library.search('oak')).toEqual([]);
    expect(await f.library.search({ text: 'pine', tags: ['WOOD', 'furniture'] })).toHaveLength(1);
    await f.library.addTags(oak.id, ['Wood']);
    expect(await f.library.listTags()).toEqual([
      { name: 'furniture', count: 1 },
      { name: 'wood', count: 1 },
    ]);
    await f.library.removeTags(oak.id, ['WOOD', 'missing']);
    expect(await f.library.search({ tags: ['wood'] })).toEqual([]);
    await expect(f.library.update(oak.id, { metadata: { name: '' } })).rejects.toMatchObject({
      code: 'INVALID_MODEL',
    });
    expect((await f.library.get(oak.id))?.metadata.name).toBe('Pine chair');
    const second = await f.library.create({ metadata: { name: 'Pine chair' } });
    expect((await f.library.page({ limit: 1 })).total).toBe(2);
    expect(await f.library.list({ limit: 1, offset: 1 })).toHaveLength(1);
    await f.library.delete(oak.id);
    expect(await f.library.get(oak.id)).toBeNull();
    expect((await f.library.get(second.id))?.id).toBe(second.id);
    await expect(
      f.library.create({ metadata: { name: 'bad', source: { url: 'javascript:alert(1)' } } }),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL' });
  } finally {
    await f.close();
  }
});

test('file packages preserve dependencies, deduplicate, export, reimport and retain shared assets', async () => {
  const f = await fixture();
  try {
    fs.mkdirSync(path.join(f.source, 'textures'));
    fs.writeFileSync(path.join(f.source, 'mesh.bin'), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(f.source, 'textures', 'map.png'), Buffer.from('test image payload'));
    const file = path.join(f.source, 'scene.gltf');
    fs.writeFileSync(
      file,
      JSON.stringify({
        asset: { version: '2.0' },
        buffers: [{ uri: 'mesh.bin', byteLength: 4 }],
        images: [{ uri: 'textures/map.png' }],
      }),
    );
    const dry = await f.library.importFile({ path: file, dryRun: true });
    expect(dry.files).toHaveLength(3);
    expect(await f.library.list()).toEqual([]);
    const a = (await f.library.importFile({ path: file })).model!,
      b = (await f.library.importFile({ path: file })).model!;
    expect(a.files).toEqual(b.files);
    expect(a.files.map((f) => f.path)).toEqual(['mesh.bin', 'scene.gltf', 'textures/map.png']);
    const bundle = path.join(f.root, 'scene.zip');
    await f.library.exportModel({ modelId: a.id, outputPath: bundle });
    const c = (await f.library.importBundle({ path: bundle })).model!;
    expect(c.id).not.toBe(a.id);
    expect(c.files).toEqual(a.files);
    expect(c.metadata.source.originalId).toBe(a.id);
    await expect(
      f.library.exportModel({ modelId: a.id, outputPath: bundle }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await f.library.delete(a.id);
    expect((await f.library.gc()).assets).toEqual([]);
    await f.library.delete(b.id);
    await f.library.delete(c.id);
    expect((await f.library.gc()).assets).toHaveLength(3);
    expect((await f.library.gc({ dryRun: false })).assets).toHaveLength(3);
    expect((await f.library.validate()).ok).toBe(true);
  } finally {
    await f.close();
  }
});

test('invalid packages, traversal, missing dependencies, bad hashes and symlinks leave no records', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.source, 'scene.gltf');
    for (const uri of [
      '../secret.bin',
      'https://evil.test/file.bin',
      '%2e%2e/secret.bin',
      'missing.bin',
    ]) {
      fs.writeFileSync(file, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri }] }));
      await expect(f.library.importFile({ path: file })).rejects.toBeDefined();
      expect(await f.library.list()).toEqual([]);
    }
    fs.writeFileSync(file, gltf);
    fs.symlinkSync(file, path.join(f.source, 'linked.gltf'));
    await expect(
      f.library.importFile({ path: path.join(f.source, 'linked.gltf') }),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    const manifest = path.join(f.source, 'manifest.json');
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        metadata: { name: 'Bad' },
        entrypoint: 'scene.gltf',
        files: [{ path: 'scene.gltf', sha256: '0'.repeat(64) }],
      }),
    );
    await expect(f.library.importManifest({ manifestPath: manifest })).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
    });
    const model = (await f.library.importFile({ path: file })).model!;
    fs.writeFileSync(await f.library.resolveAsset(model.files[0].assetId), 'tampered');
    expect((await f.library.validate()).ok).toBe(false);
  } finally {
    await f.close();
  }
});

test('lifecycle and schema guards preserve existing libraries and rollback failures', async () => {
  const f = await fixture();
  try {
    const db = new Database(f.directory);
    await expect(
      async () =>
        await db.transaction(async () => {
          await db.query('INSERT INTO tags VALUES($1)', ['rollback']);
          throw Error('stop');
        }),
    ).rejects.toThrow();
    expect(await db.all("SELECT * FROM tags WHERE name='rollback'", [])).toEqual([]);
    expect(
      (await db.one(
        "SELECT count(*) n FROM pg_constraint WHERE contype='f' AND connamespace=$1::regnamespace",
        [db.schema],
      ))!.n,
    ).toBeGreaterThan(0);
    await db.close();
    const parallel = await ModelsLibrary.open({ root: f.directory });
    await f.library.create({ metadata: { name: 'Shared' } });
    expect(await parallel.list()).toHaveLength(1);
    await parallel.close();
    await f.library.close();
    await expect(f.library.list()).rejects.toMatchObject({ code: 'LIBRARY_CLOSED' });
    const newer = new Database(f.directory);
    await newer.query('UPDATE schema_migrations SET version=99');
    await newer.close();
    await expect(ModelsLibrary.open({ root: f.directory })).rejects.toMatchObject({
      code: 'UNSUPPORTED_SCHEMA',
    });
  } finally {
    await f.close();
  }
});
