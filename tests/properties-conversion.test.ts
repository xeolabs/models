import fs from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { ConversionRunner } from '../src/conversion/ConversionRunner.js';

async function setup() {
  const f = await fixture();
  await f.library.close();
  const runtimeDirectory = path.join(f.root, 'engine');
  fs.mkdirSync(runtimeDirectory);
  fs.copyFileSync(
    new URL('./fixtures/ifc-providers/engine-fixture.js', import.meta.url),
    path.join(runtimeDirectory, 'viewer_wasm.js'),
  );
  fs.writeFileSync(
    path.join(runtimeDirectory, 'viewer_wasm_bg.wasm'),
    Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
  );
  fs.writeFileSync(path.join(runtimeDirectory, 'package.json'), '{"type":"module"}');
  const library = await ModelsLibrary.open({
    root: f.directory,
    processingWorker: true,
    xeoIFC: { runtimeDirectory },
  });
  return {
    ...f,
    library,
    async close() {
      await library.close();
      await f.close();
    },
  };
}
const source = new URL('./fixtures/ifc-providers/Building-Architecture.ifc', import.meta.url)
  .pathname;
async function document(library: ModelsLibrary, id: string) {
  const file = await library.resolveFormatFile(id, 'datamodel', 'model.datamodel.json');
  return JSON.parse(fs.readFileSync(file.path, 'utf8'));
}

test('IFC external mode writes native values once, serves thin JSON, and reuses XGF for other formats', async () => {
  const f = await setup();
  const run = vi.spyOn(ConversionRunner.prototype, 'run');
  try {
    const model = (await f.library.importFile({ path: source, propertySetMode: 'external' }))
      .model!;
    expect(await f.library.propertiesInfo(model.id)).toMatchObject({
      mode: 'external',
      ready: false,
    });
    await f.library.getFormat(model.id, 'xgf');
    const thin = await document(f.library, model.id);
    expect(thin.propertySetMode).toBe('external');
    expect(thin.propertySets).toEqual([]);
    const info = await f.library.propertiesInfo(model.id);
    expect(info).toMatchObject({ ready: true, revision: thin.revisionId, propertySetCount: 2 });
    const page = await f.library.getPropertySets(model.id, {
      revision: info.revision!,
      ids: thin.objects.find((object: { id: string }) => object.id === 'wall').propertySetIds,
    });
    expect(page.propertySets[0].properties).toEqual([
      { name: 'Height', value: 3, description: 'Unit: m' },
    ]);
    const offline = await f.library.resolveDataModelFile(model.id, { propertySetMode: 'embedded' });
    const complete = JSON.parse(fs.readFileSync(offline.path, 'utf8'));
    expect(complete.propertySetMode).toBe('embedded');
    expect(complete.propertySets).toHaveLength(2);
    expect((await document(f.library, model.id)).propertySetMode).toBe('external');
    await f.library.getFormat(model.id, 'glb');
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'ifc')).toHaveLength(1);
    const glbData = await f.library.resolveFormatFile(model.id, 'glb', 'model.datamodel.json');
    expect(JSON.parse(fs.readFileSync(glbData.path, 'utf8')).propertySets).toEqual([]);
    await f.library.configureProperties(model.id, { mode: 'embedded' });
    const embedded = await document(f.library, model.id);
    expect(embedded.propertySetMode).toBe('embedded');
    expect(embedded.propertySets).toHaveLength(2);
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'ifc')).toHaveLength(1);
    const directory = path.join(f.directory, 'properties', model.id);
    await f.library.delete(model.id);
    expect(fs.existsSync(directory)).toBe(false);
  } finally {
    run.mockRestore();
    await f.close();
  }
});

test('switching storage modes transforms the cached semantic document without re-reading IFC', async () => {
  const f = await setup();
  const run = vi.spyOn(ConversionRunner.prototype, 'run');
  try {
    fs.copyFileSync(source, path.join(f.source, 'building.ifc'));
    fs.mkdirSync(path.join(f.source, 'provenance'));
    const notice = 'Original source attribution must survive conversion.\n';
    fs.writeFileSync(path.join(f.source, 'provenance', 'README.md'), notice);
    const manifestPath = path.join(f.source, 'manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        metadata: {
          name: 'Attributed IFC',
          source: { license: 'CC-BY-4.0', attribution: 'Fixture author' },
        },
        entrypoint: 'building.ifc',
        files: [{ path: 'building.ifc' }, { path: 'provenance/README.md' }],
      }),
    );
    const model = (await f.library.importManifest({ manifestPath })).model!;
    const full = await document(f.library, model.id);
    expect(full.propertySets).toHaveLength(2);
    const change = await f.library.configureProperties(model.id, { mode: 'external' });
    await vi.waitFor(
      async () => {
        const job = (await f.library.processing(model.id)).jobs.find(
          (item) => item.id === change.job.id,
        )!;
        expect(job.status, job.error).toBe('completed');
      },
      { timeout: 15000, interval: 100 },
    );
    expect((await document(f.library, model.id)).propertySets).toEqual([]);
    for (const format of ['xgf', 'datamodel'] as const) {
      const copiedNotice = await f.library.resolveFormatFile(
        model.id,
        format,
        'provenance/README.md',
      );
      expect(fs.readFileSync(copiedNotice.path, 'utf8')).toBe(notice);
      const conversionNotice = await f.library.resolveFormatFile(
        model.id,
        format,
        'provenance/conversion-notice.txt',
      );
      expect(fs.readFileSync(conversionNotice.path, 'utf8')).toContain(`to ${format} by xeokit`);
    }
    const back = await f.library.configureProperties(model.id, { mode: 'embedded' });
    await vi.waitFor(
      async () => {
        const job = (await f.library.processing(model.id)).jobs.find(
          (item) => item.id === back.job.id,
        )!;
        expect(job.status, job.error).toBe('completed');
      },
      { timeout: 15000, interval: 100 },
    );
    expect((await document(f.library, model.id)).propertySets).toEqual(full.propertySets);
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'ifc')).toHaveLength(1);
    expect(run.mock.calls.some(([request]) => request.propertyTask === 'externalize')).toBe(true);
  } finally {
    run.mockRestore();
    await f.close();
  }
});
