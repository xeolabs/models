import { expect, test, vi } from 'vitest';
import { PreviewController } from '../app/preview/PreviewController';
import {
  PreviewSourceResolver,
  previewFormats,
  LARGE_PREVIEW_BYTES,
} from '../app/preview/PreviewSourceResolver';
import { initialPreviewState, type PreviewEngine, type PreviewState } from '../app/preview/types';
import { ServerModelsClient } from '../src/browser/ServerModelsClient';
import type { ModelRecord } from '../src/domain/types';
import { readBytes, resourceUrl } from '../tools/preview/runtime';
import { PreviewTextures } from '../tools/preview/PreviewTextures';

const model = (id = 'one', bytes = 100): ModelRecord => ({
  id,
  format: 'obj',
  entrypoint: 'model.obj',
  files: [{ path: 'model.obj', assetId: 'a'.repeat(64), bytes, mime: 'text/plain' }],
  metadata: { name: id, description: '', tags: [], source: {} },
  createdAt: '',
  updatedAt: '',
  warnings: [],
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function setup() {
  let state: PreviewState = initialPreviewState();
  const engine: PreviewEngine = {
    mount: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(undefined),
    setEffect: vi.fn(),
    fit: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  const sources = new PreviewSourceResolver();
  vi.spyOn(sources, 'resolve').mockResolvedValue({
    format: 'xgf',
    url: 'http://localhost/model.xgf',
  });
  const create = vi.fn().mockResolvedValue(engine);
  const controller = new PreviewController(
    create,
    (value) => {
      state = value;
    },
    sources,
  );
  return {
    controller,
    engine,
    create,
    sources,
    get state() {
      return state;
    },
  };
}

test('background warmup is shared, loads no model and survives repeated previews', async () => {
  const f = setup();
  await Promise.all([f.controller.warm(), f.controller.warm()]);
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.engine.load).not.toHaveBeenCalled();
  await f.controller.open(model());
  expect(f.state.phase).toBe('ready');
  await f.controller.setMode('pathTracing');
  expect(f.state.mode).toBe('pathTracing');
  f.controller.close();
  await f.controller.open(model('two'));
  expect(f.state.mode).toBe('engineering');
  expect(f.create).toHaveBeenCalledTimes(1);
  expect(f.engine.load).toHaveBeenCalledTimes(2);
  expect(f.engine.destroy).not.toHaveBeenCalled();
  await f.controller.destroy();
  expect(f.engine.destroy).toHaveBeenCalledOnce();
});

test('each opening chooses its style from actual textures and resets all optional effects', async () => {
  const f = setup();
  vi.mocked(f.engine.load).mockImplementation(async (_source, _signal, _progress, textures) => {
    await textures();
  });
  await f.controller.open(model());
  expect(f.engine.setMode).toHaveBeenLastCalledWith('pbr');
  expect(f.state.mode).toBe('pbr');
  expect(f.state.effects).toEqual({ textures: true, edges: false, sao: false, shadows: false });
  f.controller.setEffect('edges', true);
  f.controller.setEffect('sao', true);
  f.controller.setEffect('shadows', true);
  await f.controller.setMode('pathTracing');
  f.controller.close();
  await f.controller.open(model('textured again'));
  expect(f.state.mode).toBe('pbr');
  expect(f.state.effects).toEqual({ textures: true, edges: false, sao: false, shadows: false });
  vi.mocked(f.engine.load).mockResolvedValueOnce(undefined);
  await f.controller.open(model('without textures'));
  expect(f.state.mode).toBe('engineering');
  expect(f.state.effects).toEqual({ textures: false, edges: false, sao: false, shadows: false });
  await f.controller.destroy();
});

test('later streamed textures enable PBR once without overriding user choices or newer openings', async () => {
  const f = setup();
  await f.controller.open(model());
  const firstTextures = vi.mocked(f.engine.load).mock.calls[0][3];
  await firstTextures();
  expect(f.state.mode).toBe('pbr');
  await f.controller.setMode('engineering');
  await firstTextures();
  expect(f.state.mode).toBe('engineering');
  await f.controller.open(model('second'));
  await firstTextures();
  expect(f.state.mode).toBe('engineering');
  const secondTextures = vi.mocked(f.engine.load).mock.calls[1][3];
  f.controller.setEffect('edges', true);
  await secondTextures();
  expect(f.state.mode).toBe('engineering');
  expect(f.state.effects.edges).toBe(true);
  await f.controller.open(model('third'));
  const thirdTextures = vi.mocked(f.engine.load).mock.calls[2][3];
  await f.controller.setMode('rayTracing');
  await thirdTextures();
  expect(f.state.mode).toBe('rayTracing');
  await f.controller.destroy();
});

test('SDK texture detection waits for loaded assets and ignores eviction and cancelled loads', async () => {
  const model = { textures: {} as Record<string, never> };
  const abort = new AbortController();
  const notify = vi.fn().mockResolvedValue(undefined);
  const textures = new PreviewTextures(model, abort.signal, notify);
  await textures.check();
  expect(notify).not.toHaveBeenCalled();
  model.textures.albedo = {} as never;
  await Promise.all([textures.check(), textures.check()]);
  expect(notify).toHaveBeenCalledOnce();
  delete model.textures.albedo;
  await textures.check();
  model.textures.albedo = {} as never;
  await textures.check();
  expect(notify).toHaveBeenCalledOnce();
  const otherNotify = vi.fn().mockResolvedValue(undefined);
  const cancelled = new PreviewTextures(model, abort.signal, otherNotify);
  const pending = cancelled.check();
  abort.abort();
  await pending;
  await cancelled.check();
  expect(otherNotify).not.toHaveBeenCalled();
});

test('closing during format preparation aborts the request and cannot resurrect the modal', async () => {
  const f = setup(),
    pending = deferred<{ format: 'xgf'; url: string }>();
  vi.mocked(f.sources.resolve).mockReturnValueOnce(pending.promise);
  const opening = f.controller.open(model());
  await vi.waitFor(() => expect(f.sources.resolve).toHaveBeenCalled());
  const signal = vi.mocked(f.sources.resolve).mock.calls[0][1];
  f.controller.close();
  expect(signal.aborted).toBe(true);
  pending.resolve({ format: 'xgf', url: 'old' });
  await opening;
  expect(f.state.open).toBe(false);
  expect(f.engine.load).not.toHaveBeenCalled();
  await f.controller.destroy();
});

test('cancelled SDK work settles before reopening and late progress is ignored', async () => {
  const f = setup(),
    first = deferred<void>();
  vi.mocked(f.engine.load).mockImplementationOnce(async (_source, _signal, progress) => {
    await first.promise;
    progress({ message: 'Old model finished' });
  });
  const opening = f.controller.open(model());
  await vi.waitFor(() => expect(f.engine.load).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(f.engine.load).mock.calls[0][1];
  f.controller.cancel();
  expect(signal.aborted).toBe(true);
  expect(f.state.phase).toBe('cancelled');
  const next = f.controller.open(model('two'));
  expect(f.engine.load).toHaveBeenCalledTimes(1);
  first.resolve();
  await Promise.all([opening, next]);
  expect(f.state.model?.id).toBe('two');
  expect(f.state.phase).toBe('ready');
  expect(f.state.progress.message).toBe('');
  await f.controller.destroy();
});

test('initialization and model failures can be retried without leaking a model', async () => {
  const f = setup();
  f.create.mockRejectedValueOnce(new Error('No graphics device'));
  await expect(f.controller.warm()).rejects.toThrow('No graphics device');
  vi.mocked(f.engine.load).mockRejectedValueOnce(new Error('Bad geometry'));
  await f.controller.open(model());
  expect(f.state.error).toBe('Bad geometry');
  expect(f.engine.unload).toHaveBeenCalled();
  await f.controller.open(model());
  expect(f.state.phase).toBe('ready');
  expect(f.create).toHaveBeenCalledTimes(2);
  await f.controller.destroy();
});

test('closing during a rendering switch ignores its late failure', async () => {
  const f = setup(),
    pending = deferred<void>();
  await f.controller.open(model());
  vi.mocked(f.engine.setMode).mockImplementationOnce(async () => {
    await pending.promise;
    throw new Error('Old mode failed');
  });
  const switchMode = f.controller.setMode('rayTracing');
  f.controller.close();
  pending.resolve();
  await switchMode;
  expect(f.state.open).toBe(false);
  expect(f.state.rendering).toBe('');
  expect(f.state.mode).toBe('engineering');
  await f.controller.destroy();
});

test('large models choose available streams and smaller models prefer XGF', () => {
  const formats = {
    modelId: 'one',
    warnings: [],
    formats: ['datamodel', 'xgfstream', 'xgf', 'glb', 'gltf'].map((format) => ({
      format: format as 'datamodel' | 'xgf' | 'xgfstream' | 'glb' | 'gltf',
      entrypoint: 'model.' + format,
      source: 'converted' as const,
      cached: false,
    })),
  };
  expect(previewFormats(model(), formats)).toEqual(['xgf', 'glb', 'gltf', 'xgfstream']);
  expect(previewFormats(model('one', LARGE_PREVIEW_BYTES), formats)[0]).toBe('xgfstream');
  expect(
    previewFormats(model('one', LARGE_PREVIEW_BYTES), {
      ...formats,
      formats: formats.formats.filter((item) => item.format !== 'xgfstream'),
    } as typeof formats)[0],
  ).toBe('xgf');
});

test('source resolution falls back after conversion failure but never after cancellation', async () => {
  const client = {
    availableFormats: vi
      .fn()
      .mockResolvedValue({ formats: [{ format: 'xgf' }, { format: 'glb' }] }),
    getFormat: vi
      .fn()
      .mockRejectedValueOnce(new Error('Unsupported source texture'))
      .mockResolvedValue({ entrypoint: 'model.glb' }),
    formatFileUrl: vi.fn().mockReturnValue('http://localhost/model.glb'),
  };
  const resolver = new PreviewSourceResolver(async () => client as unknown as ServerModelsClient);
  expect(await resolver.resolve(model(), new AbortController().signal, () => {})).toEqual({
    format: 'glb',
    url: 'http://localhost/model.glb',
  });
  const abort = new AbortController();
  client.getFormat.mockClear().mockImplementation(async () => {
    abort.abort();
    throw new Error('cancelled');
  });
  await expect(resolver.resolve(model(), abort.signal, () => {})).rejects.toThrow();
  expect(client.getFormat).toHaveBeenCalledTimes(1);
});

test('stream resource URLs stay within the model representation', () => {
  const entry = 'https://example.test/api/model/files/index.runtime.json';
  expect(resourceUrl('chunks/one.xgf', entry)).toBe(
    'https://example.test/api/model/files/chunks/one.xgf',
  );
  for (const name of [
    '../outside.xgf',
    'https://other.test/model.xgf',
    '//other.test/a',
    '%2e%2e/outside',
  ])
    expect(() => resourceUrl(name, entry)).toThrow();
});

test('download progress and cancellation use the original signal', async () => {
  const native = globalThis.fetch,
    progress = vi.fn(),
    abort = new AbortController();
  const fetch = vi.fn().mockImplementation(async (_url, options) => {
    expect(options.signal).toBe(abort.signal);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-length': '3' } });
  });
  globalThis.fetch = fetch;
  try {
    expect(
      new Uint8Array(await readBytes('https://example.test/model', abort.signal, progress)),
    ).toEqual(new Uint8Array([1, 2, 3]));
    abort.abort();
    await expect(readBytes('https://example.test/model', abort.signal, progress)).rejects.toThrow();
  } finally {
    globalThis.fetch = native;
  }
});
