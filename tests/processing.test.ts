import fs from 'node:fs';
import sharp from 'sharp';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { fixture } from './helpers.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { ConversionRunner } from '../src/conversion/ConversionRunner.js';
import { Database } from '../src/storage/Database.js';
import { ProcessingRepository } from '../src/processing/ProcessingRepository.js';
import { ProcessingQueue } from '../src/processing/ProcessingQueue.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';
import { acquisitionOptions } from './acquisition-helpers.js';

const source = new URL('./fixtures/ifc-providers/Building-Architecture.ifc', import.meta.url)
  .pathname;
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
    runtimeDirectory,
    async close() {
      await library.close();
      await f.close();
    },
  };
}
async function settled(library: ModelsLibrary, id: string) {
  await vi.waitFor(
    async () => {
      expect((await library.processing()).jobs.find((job) => job.id === id)?.status).not.toMatch(
        /queued|running|cancelling/,
      );
    },
    { timeout: 15000, interval: 50 },
  );
  return (await library.processing()).jobs.find((job) => job.id === id)!;
}

test('IFC is parsed once; later exports read the cached XGF and exact DataModel', async () => {
  const f = await setup();
  const run = vi.spyOn(ConversionRunner.prototype, 'run');
  try {
    const model = (await f.library.importFile({ path: source })).model!;
    expect((await f.library.processing()).jobs).toHaveLength(0);
    expect(await f.library.thumbnailStatus(model.id)).toEqual({ ready: false });
    expect(run).not.toHaveBeenCalled();
    const [xgf, formats] = await Promise.all([
      f.library.getFormat(model.id, 'xgf'),
      f.library.availableFormats(model.id),
    ]);
    expect(formats.formats.find((option) => option.format === 'xgf')?.cached).toBe(true);
    expect(formats.formats.find((option) => option.format === 'datamodel')?.cached).toBe(true);
    expect(xgf.files.some((file) => file.path === 'model.datamodel.json')).toBe(true);
    const preview = await f.library.resolveThumbnail(model.id);
    expect(fs.readFileSync(preview.path).subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect((await f.library.thumbnailStatus(model.id)).ready).toBe(true);
    expect(await sharp(preview.path).metadata()).toMatchObject({
      format: 'png',
      width: 384,
      height: 288,
    });
    expect((await sharp(preview.path).stats()).channels[0].stdev).toBeGreaterThan(1);
    const semantic = await f.library.resolveFormatFile(
      model.id,
      'datamodel',
      'model.datamodel.json',
    );
    const json = JSON.parse(fs.readFileSync(semantic.path, 'utf8'));
    const [glb, stream] = await Promise.all([
      f.library.getFormat(model.id, 'glb'),
      f.library.getFormat(model.id, 'xgfstream'),
    ]);
    expect(glb.entrypoint).toBe('model.glb');
    expect(stream.entrypoint).toBe('index.runtime.json');
    const companion = await f.library.resolveFormatFile(model.id, 'glb', 'model.datamodel.json');
    expect(JSON.parse(fs.readFileSync(companion.path, 'utf8'))).toEqual(json);
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'ifc')).toHaveLength(1);
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'xgf')).toHaveLength(2);
    await f.library.getFormat(model.id, 'xgf');
    await f.library.getFormat(model.id, 'datamodel');
    await f.library.getFormat(model.id, 'glb');
    expect(run).toHaveBeenCalledTimes(3);
    fs.writeFileSync(preview.path, 'corrupt thumbnail');
    await f.library.configureProcessing({ paused: true });
    const pendingPreview = await f.library.prepareIFC(model.id);
    expect(await f.library.thumbnailStatus(model.id)).toEqual({ ready: false });
    await f.library.cancelConversion(pendingPreview.id);
    await f.library.configureProcessing({ paused: false });
    await f.library.resolveThumbnail(model.id);
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'ifc')).toHaveLength(1);
    expect(run.mock.calls.at(-1)?.[0]).toMatchObject({ sourceFormat: 'xgf', thumbnailOnly: true });
    const output = await f.library.resolveFormatFile(model.id, 'xgf', 'model.xgf');
    fs.writeFileSync(output.path, 'corrupt');
    await f.library.getFormat(model.id, 'xgf');
    expect(run.mock.calls.filter(([request]) => request.sourceFormat === 'ifc')).toHaveLength(2);
    expect((await f.library.processing()).counts.failed).toBe(0);
  } finally {
    run.mockRestore();
    await f.close();
  }
}, 30000);

test('automatic processing is opt-in, transactional, persistent and controllable', async () => {
  const f = await setup();
  let reopened: ModelsLibrary | undefined;
  try {
    await f.library.importFile({ path: source });
    expect((await f.library.processing()).jobs).toHaveLength(0);
    await f.library.configureProcessing({ automaticIFC: true, paused: true });
    await f.library.importFile({ path: source, dryRun: true });
    expect((await f.library.processing()).jobs).toHaveLength(0);
    const model = (await f.library.importFile({ path: source })).model!;
    const [job] = (await f.library.processing()).jobs;
    expect(job).toMatchObject({
      modelId: model.id,
      kind: 'prepare-ifc',
      status: 'queued',
      source: 'automatic',
    });
    await f.library.close();
    reopened = await ModelsLibrary.open({
      root: f.directory,
      processingWorker: true,
      xeoIFC: { runtimeDirectory: f.runtimeDirectory },
    });
    expect((await reopened.processing()).settings).toMatchObject({
      automaticIFC: true,
      paused: true,
      cpuCores: 1,
    });
    expect((await reopened.processing()).jobs[0].id).toBe(job.id);
    await reopened.cancelConversion(job.id);
    expect((await reopened.processing()).jobs[0].status).toBe('cancelled');
    const retry = await reopened.retryConversion(job.id);
    expect(retry.id).not.toBe(job.id);
    await reopened.configureProcessing({ paused: false });
    expect((await settled(reopened, retry.id)).status).toBe('completed');
    expect((await reopened.getFormat(model.id, 'xgf')).cached).toBe(true);
    expect((await reopened.getFormat(model.id, 'datamodel')).cached).toBe(true);
    await reopened.delete(model.id);
    expect((await reopened.processing()).jobs).toHaveLength(0);
  } finally {
    await reopened?.close();
    await f.close();
  }
}, 30000);

test('another library connection can cancel running work without publishing partial outputs', async () => {
  const f = await setup();
  const controller = await ModelsLibrary.open({ root: f.directory });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const run = vi
    .spyOn(ConversionRunner.prototype, 'run')
    .mockImplementation(async (_request, _root, signal) => {
      started();
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw Error('worker stopped');
    });
  try {
    const model = (await f.library.importFile({ path: source })).model!;
    const job = await f.library.prepareIFC(model.id);
    await ready;
    const waiting = f.library.getFormat(model.id, 'xgf');
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'CONVERSION_CANCELLED' });
    await controller.cancelConversion(job.id);
    await rejected;
    expect((await settled(f.library, job.id)).status).toBe('cancelled');
    const cache = path.join(f.directory, '.cache/conversions', model.id);
    expect(fs.existsSync(cache)).toBe(false);
  } finally {
    run.mockRestore();
    await controller.close();
    await f.close();
  }
});

test('PostgreSQL claims serialize workers across connections, prioritize requests and preserve live owners', async () => {
  const f = await fixture();
  const db = new Database(f.directory),
    other = new Database(f.directory);
  const repo = new ProcessingRepository(db),
    second = new ProcessingRepository(other);
  try {
    const first = await f.library.create({ metadata: { name: 'Automatic' } }),
      next = await f.library.create({ metadata: { name: 'Requested' } });
    await repo.configure({ automaticIFC: true });
    const auto = await db.transaction(
      async () => await repo.enqueue(first.id, 'prepare-ifc', 'xgf', 'automatic'),
    );
    const manual = await db.transaction(
      async () => await repo.enqueue(next.id, 'prepare-ifc', 'xgf', 'requested'),
    );
    expect((await repo.claim())?.id).toBe(manual.id);
    expect(await second.claim()).toBeNull();
    expect((await second.get(manual.id))?.status).toBe('running');
    await second.cancel(manual.id);
    expect((await repo.get(manual.id))?.status).toBe('cancelling');
    await repo.finish(manual.id, 'cancelled');
    expect((await second.claim())?.id).toBe(auto.id);
    await db.query('UPDATE processing_jobs SET owner_json=$1 WHERE id=$2', [
      JSON.stringify({ ...second.owner, pid: 99999999 }),
      auto.id,
    ]);
    expect(await repo.claim()).toBeNull();
    expect((await repo.get(auto.id))?.status).toBe('interrupted');
    expect(
      (await db.one(
        "SELECT count(*) n FROM pg_constraint WHERE contype='f' AND NOT convalidated AND connamespace=$1::regnamespace",
        [db.schema],
      ))!.n,
    ).toBe(0);
  } finally {
    await db.close();
    await other.close();
    await f.close();
  }
});

test('HTTP and TypeScript expose queue controls, reject invalid settings and protect mutations', async () => {
  const f = await setup();
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    xeoIFC: { runtimeDirectory: f.runtimeDirectory },
    acquisition: acquisitionOptions(),
  });
  try {
    const client = await ServerModelsClient.open(server.url);
    await client.configureProcessing({ automaticIFC: true, paused: true });
    const model = (await f.library.importFile({ path: source })).model!;
    const job = await client.prepareIFC(model.id);
    expect((await client.processing(model.id)).jobs).toHaveLength(1);
    expect((await client.processing()).counts.queued).toBe(1);
    await client.cancelConversion(job.id);
    expect((await client.processing()).counts.cancelled).toBe(1);
    await expect(client.configureProcessing({ cpuCores: 999 })).rejects.toThrow('invalid value');
    const denied = await fetch(server.url + '/api/processing/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: '{"automaticIFC":true}',
    });
    expect(denied.status).toBe(403);
    const noAction = await fetch(server.url + '/api/processing/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"automaticIFC":true}',
    });
    expect(noAction.ok).toBe(false);
    const retry = await client.retryConversion(job.id);
    expect(retry.status).toBe('queued');
    expect((await f.library.processingSettings()).paused).toBe(true);
    await client.configureProcessing({ paused: false });
    expect((await settled(f.library, retry.id)).status).toBe('completed');
    const thumbnail = await client.thumbnailStatus(model.id);
    expect(thumbnail.ready).toBe(true);
    const response = await fetch(thumbnail.url!);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).width).toBe(384);
    await f.library.delete(model.id);
    expect((await fetch(thumbnail.url!)).status).toBe(404);
  } finally {
    await server.close();
    await f.close();
  }
});

test('closing an active service interrupts its work and leaves pending jobs for reopening', async () => {
  const f = await fixture();
  const db = new Database(f.directory),
    repo = new ProcessingRepository(db);
  const queue = new ProcessingQueue(repo, async (_job, signal) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
  });
  try {
    const model = await f.library.create({ metadata: { name: 'Model' } });
    const job = await queue.enqueue(model.id, 'convert', 'glb');
    await vi.waitFor(async () => expect((await repo.get(job.id))?.status).toBe('running'));
    await queue.close();
    expect((await repo.get(job.id))?.status).toBe('interrupted');
    await expect(queue.wait(job.id)).rejects.toMatchObject({ code: 'CONVERSION_CANCELLED' });
  } finally {
    await queue.close();
    await db.close();
    await f.close();
  }
});
