import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { XeoIFCRuntime } from '../src/conversion/XeoIFCRuntime.js';
import { fixture } from './helpers.js';
const file = (name: string) => new URL('./fixtures/ifc-providers/' + name, import.meta.url);
function engine(root: string) {
  const directory = path.join(root, 'engine');
  fs.mkdirSync(directory);
  fs.copyFileSync(file('engine-fixture.js'), path.join(directory, 'viewer_wasm.js'));
  fs.writeFileSync(
    path.join(directory, 'viewer_wasm_bg.wasm'),
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  );
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  return directory;
}
test('the actual SDK XeoIFC adapter preserves semantics, warnings and credits through cached downloads', async () => {
  const f = await fixture();
  await f.library.close();
  const runtimeDirectory = engine(f.root);
  const library = await ModelsLibrary.open({ root: f.directory, xeoIFC: { runtimeDirectory } });
  try {
    const model = (await library.importFile({ path: file('Building-Architecture.ifc').pathname }))
      .model!;
    await library.update(model.id, {
      metadata: {
        source: {
          license: 'CC-BY-4.0',
          attribution: 'buildingSMART International Ltd.; source credits retained',
          url: 'https://github.com/buildingSMART/Certification-datasets',
        },
      },
    });
    const options = await library.availableFormats(model.id);
    expect(options.formats.map((option) => option.format)).toEqual(
      expect.arrayContaining(['ifc', 'xgf', 'xgfstream', 'glb', 'datamodel']),
    );
    const first = await library.getFormat(model.id, 'xgf');
    // IFC discovery also prepares the reusable XGF and semantic companion.
    expect(first.cached).toBe(true);
    expect(first.warnings.join(' ')).toContain('Test engine diagnostic');
    const semantic = await library.resolveFormatFile(model.id, 'xgf', 'model.datamodel.json');
    expect(fs.readFileSync(semantic.path, 'utf8')).toContain('IfcWall');
    const standalone = await library.getFormat(model.id, 'datamodel');
    expect(standalone.entrypoint).toBe('model.datamodel.json');
    const jsonFile = await library.resolveFormatFile(model.id, 'datamodel', standalone.entrypoint);
    const semanticJSON = JSON.parse(fs.readFileSync(jsonFile.path, 'utf8'));
    expect(semanticJSON).toEqual(JSON.parse(fs.readFileSync(semantic.path, 'utf8')));
    expect(semanticJSON.version).toBe('1.0');
    expect(semanticJSON.objects).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'wall', type: 'IfcWall' })]),
    );
    expect(semanticJSON.propertySets.length).toBeGreaterThan(0);
    expect(semanticJSON.relationships.length).toBeGreaterThan(0);
    expect(standalone.files.filter((file) => file.path === standalone.entrypoint)).toHaveLength(1);
    expect(standalone.files.some((file) => file.path === 'provenance/conversion-notice.txt')).toBe(
      true,
    );
    expect((await library.getFormat(model.id, 'datamodel')).cached).toBe(true);

    const notice = await library.resolveFormatFile(
      model.id,
      'xgf',
      'provenance/conversion-notice.txt',
    );
    expect(fs.readFileSync(notice.path, 'utf8')).toContain('Converted from ifc to xgf');
    expect((await library.getFormat(model.id, 'xgf')).cached).toBe(true);
    fs.appendFileSync(path.join(runtimeDirectory, 'viewer_wasm.js'), '\n// New engine revision\n');
    expect((await library.getFormat(model.id, 'xgf')).cached).toBe(false);
    const stream = await library.getFormat(model.id, 'xgfstream');
    expect(stream.entrypoint).toBe('index.runtime.json');
    expect(stream.files.some((item) => item.path.endsWith('.xgf'))).toBe(true);
    await library.delete(model.id);
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions', model.id))).toBe(false);
  } finally {
    await library.close();
    await f.close();
  }
}, 30000);
test('original IFC downloads remain available without an engine; IFC input never silently falls back', async () => {
  const f = await fixture();
  vi.stubEnv('MODELS_XEOIFC_DIR', '');
  try {
    const model = (await f.library.importFile({ path: file('Building-Architecture.ifc').pathname }))
      .model!;
    const formats = await f.library.availableFormats(model.id);
    expect(formats.formats.map((option) => option.format)).toEqual(['ifc']);
    expect(formats.warnings.join(' ')).toContain('MODELS_XEOIFC_DIR');
    expect((await f.library.getFormat(model.id, 'ifc')).source).toBe('original');
    await expect(
      f.library.convertModel({ modelId: model.id, format: 'xgf' }),
    ).rejects.toMatchObject({ code: 'CONVERSION_FAILED' });
  } finally {
    vi.unstubAllEnvs();
    await f.close();
  }
});
test('runtime validation rejects missing, corrupt and linked binaries; keys affect cache identity', async () => {
  const f = await fixture();
  try {
    const runtimeDirectory = engine(f.root);
    const original = new XeoIFCRuntime({ runtimeDirectory }).resolve().revision;
    expect(
      new XeoIFCRuntime({ runtimeDirectory, licenceKey: 'private-key' }).resolve().revision,
    ).not.toBe(original);
    const wasm = path.join(runtimeDirectory, 'viewer_wasm_bg.wasm');
    fs.writeFileSync(wasm, 'corrupt');
    expect(() => new XeoIFCRuntime({ runtimeDirectory }).resolve()).toThrow('signature');
    fs.rmSync(wasm);
    fs.symlinkSync(file('Building-Architecture.ifc').pathname, wasm);
    expect(() => new XeoIFCRuntime({ runtimeDirectory }).resolve()).toThrow();
    fs.rmSync(wasm);
    expect(() => new XeoIFCRuntime({ runtimeDirectory }).resolve()).toThrow('could not read');
  } finally {
    await f.close();
  }
});
test.skipIf(!process.env.MODELS_XEOIFC_DIR)(
  'installed XeoIFC WASM converts an actual buildingSMART IFC into GLB, XGF and an XGF stream',
  async () => {
    const f = await fixture();
    try {
      const model = (
        await f.library.importFile({ path: file('Building-Architecture.ifc').pathname })
      ).model!;
      for (const format of ['glb', 'xgf', 'xgfstream', 'datamodel'] as const) {
        const converted = await f.library.getFormat(model.id, format);
        expect(
          converted.files.some((file) => file.path === converted.entrypoint && file.bytes > 100),
        ).toBe(true);
        const semantic = await f.library.resolveFormatFile(
          model.id,
          format,
          'model.datamodel.json',
        );
        expect(fs.readFileSync(semantic.path, 'utf8')).toContain('Ifc');
      }
    } finally {
      await f.close();
    }
  },
  90000,
);
