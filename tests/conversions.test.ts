import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { ConversionRunner } from '../src/conversion/ConversionRunner.js';
import type { ConversionFormat } from '../src/conversion/types.js';

async function triangle() {
  const f = await fixture();
  const source = path.join(f.source, 'triangle.obj');
  fs.writeFileSync(source, 'o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const model = (await f.library.importFile({ path: source })).model!;
  const cache = path.join(f.directory, '.cache/conversions', model.id);
  const cachedFile = (format: string, name: string) =>
    path.join(cache, fs.readdirSync(cache)[0], format, name);
  return { ...f, model, source, cache, cachedFile };
}

test('real SDK outputs are generated on demand, reused after reopen, and removed with the model', async () => {
  const f = await triangle();
  let reopened: ModelsLibrary | undefined;
  try {
    expect(fs.existsSync(f.cache)).toBe(false);
    const choices = await f.library.downloadFormats(f.model.id);
    expect(choices.formats.map((item) => item.format)).toContain('glb');
    expect(choices.formats.every((item) => !item.cached)).toBe(true);
    expect(fs.existsSync(f.cachedFile('glb', 'model.glb'))).toBe(false);
    const first = await f.library.convertModel({ modelId: f.model.id, format: 'glb' });
    expect(first.cached).toBe(false);
    expect(fs.readFileSync(f.cachedFile('glb', 'model.glb')).subarray(0, 4).toString()).toBe(
      'glTF',
    );
    const modified = fs.statSync(f.cachedFile('glb', 'model.glb')).mtimeMs;
    await f.library.update(f.model.id, { metadata: { name: 'Renamed' } });
    await f.library.close();
    reopened = await ModelsLibrary.open({ root: f.directory });
    const again = await reopened.convertModel({ modelId: f.model.id, format: 'glb' });
    expect(again).toEqual({ ...first, cached: true });
    expect(fs.statSync(f.cachedFile('glb', 'model.glb')).mtimeMs).toBe(modified);
    const duplicate = (await reopened.importFile({ path: f.source })).model!;
    await reopened.convertModel({ modelId: duplicate.id, format: 'glb' });
    await reopened.delete(f.model.id);
    expect(fs.existsSync(f.cache)).toBe(false);
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions', duplicate.id))).toBe(true);
    expect((await reopened.get(duplicate.id))?.files).toEqual(f.model.files);
    expect(
      fs.existsSync((await reopened.resolveFile(duplicate.id, duplicate.entrypoint!)).path),
    ).toBe(true);
    await expect(
      reopened.convertModel({ modelId: f.model.id, format: 'glb' }),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  } finally {
    await reopened?.close();
    await f.close();
  }
}, 30000);

test('every offered triangle output runs through the real SDK exporter', async () => {
  const f = await triangle();
  try {
    const choices = await f.library.downloadFormats(f.model.id);
    const discoverable = await f.library.availableFormats(f.model.id);
    for (const option of choices.formats) {
      const result = await f.library.convertModel({ modelId: f.model.id, format: option.format });
      expect(result.entrypoint).toBe(
        discoverable.formats.find((item) => item.format === option.format)?.entrypoint,
      );
      expect(result.files.length, option.format).toBeGreaterThan(0);
      for (const file of result.files)
        expect(file.bytes, option.format + '/' + file.path).toBeGreaterThan(0);
    }
    expect(choices.formats.map((item) => item.format)).not.toContain('e57');
    const glb = (await f.library.importFile({ path: f.cachedFile('glb', 'model.glb') })).model!;
    const outputPath = path.join(f.root, 'obj-download');
    const obj = await f.library.exportConvertedModel({
      modelId: glb.id,
      format: 'obj',
      outputPath,
    });
    expect(obj.filename).toBe('model-obj.zip');
    expect(obj.files.map((file) => file.path)).toEqual(['model.obj', 'model.mtl']);
    expect(fs.readFileSync(outputPath).subarray(0, 2).toString()).toBe('PK');
  } finally {
    await f.close();
  }
}, 60000);

test('corrupt cached bytes are regenerated and concurrent requests share one conversion', async () => {
  const f = await triangle();
  const run = vi.spyOn(ConversionRunner.prototype, 'run');
  try {
    await f.library.downloadFormats(f.model.id);
    run.mockClear();
    const [a, b] = await Promise.all([
      f.library.convertModel({ modelId: f.model.id, format: 'xgf' }),
      f.library.convertModel({ modelId: f.model.id, format: 'xgf' }),
    ]);
    expect(a.files).toEqual(b.files);
    expect(run).toHaveBeenCalledTimes(1);
    fs.writeFileSync(f.cachedFile('xgf', 'model.xgf'), 'corrupt');
    expect(
      (await f.library.downloadFormats(f.model.id)).formats.find((item) => item.format === 'xgf')
        ?.cached,
    ).toBe(false);
    const recovered = await f.library.convertModel({ modelId: f.model.id, format: 'xgf' });
    expect(recovered.cached).toBe(false);
    expect(fs.statSync(f.cachedFile('xgf', 'model.xgf')).size).toBe(
      recovered.files.find((file) => file.path === 'model.xgf')?.bytes,
    );
  } finally {
    run.mockRestore();
    await f.close();
  }
}, 30000);

test('deletion through another connection prevents an in-flight conversion from republishing', async () => {
  const f = await triangle();
  const second = await ModelsLibrary.open({ root: f.directory });
  let release!: () => void, ready!: () => void;
  const finished = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await f.library.downloadFormats(f.model.id);
  const real = ConversionRunner.prototype.run;
  const run = vi.spyOn(ConversionRunner.prototype, 'run').mockImplementation(async function (
    this: ConversionRunner,
    ...args
  ) {
    const result = await real.apply(this, args);
    ready();
    await proceed;
    return result;
  });
  try {
    const conversion = f.library.convertModel({ modelId: f.model.id, format: 'glb' });
    const rejected = expect(conversion).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
    await finished;
    await second.delete(f.model.id);
    release();
    await rejected;
    expect(fs.existsSync(f.cache)).toBe(false);
  } finally {
    release();
    run.mockRestore();
    await second.close();
    await f.close();
  }
}, 30000);

test('deleting during local conversion cancels the worker and leaves no cache', async () => {
  const f = await triangle();
  await f.library.downloadFormats(f.model.id);
  const real = ConversionRunner.prototype.run;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const run = vi.spyOn(ConversionRunner.prototype, 'run').mockImplementation(function (
    this: ConversionRunner,
    ...args
  ) {
    const result = real.apply(this, args);
    started();
    return result;
  });
  try {
    const converting = f.library.convertModel({ modelId: f.model.id, format: 'glb' });
    const rejected = expect(converting).rejects.toMatchObject({ code: 'CONVERSION_CANCELLED' });
    await ready;
    await f.library.delete(f.model.id);
    await rejected;
    expect(fs.existsSync(f.cache)).toBe(false);
  } finally {
    run.mockRestore();
    await f.close();
  }
});

test('unsupported sources and invalid format requests leave the originals intact', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.source, 'drawing.dxf');
    fs.writeFileSync(source, '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n');
    const model = (await f.library.importFile({ path: source })).model!;
    expect((await f.library.downloadFormats(model.id)).formats).toEqual([]);
    await expect(
      f.library.convertModel({ modelId: model.id, format: '../evil' as ConversionFormat }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions'))).toBe(false);
  } finally {
    await f.close();
  }
});

test('glTF resources and encoded textures survive a real SDK GLB conversion', async () => {
  const f = await fixture();
  try {
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
    const normals = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]).buffer);
    const uvs = Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer);
    const pixels = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=',
      'base64',
    );
    fs.writeFileSync(path.join(f.source, 'geometry.bin'), Buffer.concat([positions, normals, uvs]));
    fs.writeFileSync(path.join(f.source, 'color.png'), pixels);
    const document = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0 }] },
      ],
      buffers: [{ uri: 'geometry.bin', byteLength: 96 }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 36 },
        { buffer: 0, byteOffset: 72, byteLength: 24 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      ],
      images: [{ uri: 'color.png' }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
    };
    const input = path.join(f.source, 'textured.gltf');
    fs.writeFileSync(input, JSON.stringify(document));
    const model = (await f.library.importFile({ path: input })).model!;
    const output = path.join(f.root, 'textured.glb');
    const result = await f.library.exportConvertedModel({
      modelId: model.id,
      format: 'glb',
      outputPath: output,
    });
    expect(result.files).toHaveLength(1);
    const converted = fs.readFileSync(output);
    expect(converted.includes(pixels)).toBe(true);
    const gltf = JSON.parse(converted.subarray(20, 20 + converted.readUInt32LE(12)).toString());
    expect(gltf.materials[0].pbrMetallicRoughness.baseColorTexture).toBeDefined();
    expect(gltf.meshes[0].primitives[0].attributes.TEXCOORD_0).toBeDefined();
    await expect(
      f.library.exportConvertedModel({ modelId: model.id, format: 'glb', outputPath: output }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  } finally {
    await f.close();
  }
}, 30000);

test('point clouds offer only formats that support their geometry', async () => {
  const f = await fixture();
  try {
    const input = path.join(f.source, 'points.ply');
    fs.writeFileSync(
      input,
      'ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 1 1\n',
    );
    const model = (await f.library.importFile({ path: input })).model!;
    const formats = (await f.library.downloadFormats(model.id)).formats.map((item) => item.format);
    expect(formats).toContain('e57');
    expect(formats).not.toContain('stl');
    await expect(
      f.library.convertModel({ modelId: model.id, format: 'stl' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    const cloud = await f.library.convertModel({ modelId: model.id, format: 'e57' });
    expect(cloud.files[0].bytes).toBeGreaterThan(0);
  } finally {
    await f.close();
  }
}, 30000);

test('symlinks cannot redirect conversion cache writes or deletion', async () => {
  const f = await triangle();
  try {
    const outside = path.join(f.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep'), 'safe');
    fs.mkdirSync(path.dirname(f.cache), { recursive: true });
    fs.symlinkSync(outside, f.cache);
    await expect(
      f.library.convertModel({ modelId: f.model.id, format: 'glb' }),
    ).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    await expect(f.library.delete(f.model.id)).rejects.toMatchObject({ code: 'PATH_OUTSIDE_ROOT' });
    expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('safe');
    expect(await f.library.get(f.model.id)).not.toBeNull();
  } finally {
    await f.close();
  }
});
