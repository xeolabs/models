import { Scene, type SceneModel } from '@xeokit/sdk/model/scene';
import { Viewer, type View } from '@xeokit/sdk/viewing/viewer';
import { WebGPURenderer } from '@xeokit/sdk/viewing/renderers/webGPU';
import { WebGLRenderer } from '@xeokit/sdk/viewing/renderers/webGL';
import { ModelNavigationController } from '@xeokit/sdk/viewing/navigation/model';
import { XGFLoader } from '@xeokit/sdk/formats/xgf';
import { GLTFLoader } from '@xeokit/sdk/formats/gltf';
import type {
  PreviewEngine,
  PreviewEngineOptions,
  PreviewSource,
  PreviewProgress,
  PreviewMode,
  PreviewEffect,
} from '../../app/preview/types';
import { PreviewCamera } from './PreviewCamera';
import { PreviewRendering } from './PreviewRendering';
import { PreviewStream } from './PreviewStream';
import { PreviewTextures } from './PreviewTextures';
import { must, readBytes } from './runtime';

/**
 * Graphics resources belong to one retained viewer. Models, streaming sessions,
 * and tracing structures belong to an opening and are released on close.
 */
export class XeokitPreviewEngine implements PreviewEngine {
  private readonly scene = new Scene();
  private readonly viewer = new Viewer({ scene: this.scene });
  private readonly canvas = document.createElement('canvas');
  private readonly view: View;
  private readonly camera: PreviewCamera;
  private rendering?: PreviewRendering;
  private renderer?: WebGLRenderer | WebGPURenderer;
  private navigation?: ModelNavigationController;
  private model?: SceneModel;
  private stream?: PreviewStream;
  private abort?: AbortController;
  private loading?: Promise<void>;
  private disposed = false;
  private modeGeneration = 0;
  private readonly resize: ResizeObserver;
  private readonly stops: (() => void)[] = [];
  private constructor(private readonly options: PreviewEngineOptions) {
    this.canvas.className = 'preview-canvas';
    this.canvas.setAttribute('aria-label', 'Interactive 3D model');
    this.canvas.tabIndex = 0;
    this.view = must(
      this.viewer.createView({
        id: 'preview',
        htmlElement: this.canvas,
        backgroundColor: [0.025, 0.03, 0.04],
        camera: {
          eye: [5, -5, 4],
          look: [0, 0, 0],
          up: [0, 0, 1],
          perspectiveProjection: { fov: 50, far: 20000 },
        },
        resolutionScale: { enabled: false },
        lights: { hemispheric: { enabled: true, worldUp: [0, 0, 1] } },
      }),
    );
    this.camera = new PreviewCamera(this.view);
    this.resize = new ResizeObserver(() => this.view.needsRender());
    this.resize.observe(this.canvas);
  }
  static async create(options: PreviewEngineOptions, backend: 'webgpu' | 'webgl') {
    const engine = new XeokitPreviewEngine(options);
    try {
      engine.renderer =
        backend === 'webgpu'
          ? must(
              await WebGPURenderer.create({
                memoryConfigs: {
                  maxViews: 1,
                  compactStreamPages: true,
                  compactSealedStreamPages: true,
                },
                renderConfigs: { triangleColorMode: 'pbr', logDepth: true, edges: true },
                requestAdapterOptions: { powerPreference: 'high-performance' },
              }),
            )
          : new WebGLRenderer({ memoryConfigs: { maxViews: 1 } });
      must(engine.renderer.attachViewer(engine.viewer));
      engine.navigation = new ModelNavigationController(engine.view, {
        active: false,
        keyboardEnabledOnlyOnMouseover: true,
        pick: (view, params) => engine.renderer!.pick(view, params),
      });
      engine.rendering = new PreviewRendering(
        engine.renderer,
        engine.view,
        backend,
        options.onRendering,
      );
      engine.stops.push(
        engine.renderer.events.onError.subscribe((_renderer, error) => {
          if (!engine.disposed && engine.model && !engine.abort?.signal.aborted)
            options.onError(new Error(error.error));
        }),
      );
      return engine;
    } catch (error) {
      await engine.destroy();
      throw error;
    }
  }
  mount(host: HTMLElement, active: boolean) {
    if (this.disposed) return;
    if (this.canvas.parentElement !== host) host.append(this.canvas);
    if (this.navigation) this.navigation.active = active;
    this.view.needsRender();
  }
  async load(
    source: PreviewSource,
    signal: AbortSignal,
    progress: (value: PreviewProgress) => void,
    onTextures: () => Promise<void>,
  ) {
    await this.unload();
    signal.throwIfAborted();
    this.abort = new AbortController();
    const combined = AbortSignal.any([signal, this.abort.signal]);
    this.model = must(
      this.scene.createModel({
        id: 'preview-model',
        loadingMode: source.format === 'xgfstream' ? 'streaming' : undefined,
        updateMode: 'static',
      }),
    );
    const model = this.model;
    const textures = new PreviewTextures(model, combined, onTextures);
    const task = (async () => {
      if (source.format === 'xgfstream') {
        this.stream = new PreviewStream(this.options.onError, () => textures.check());
        await this.stream.load(source.url, model, this.view, this.camera, combined, progress);
      } else {
        const data = await readBytes(source.url, combined, progress);
        combined.throwIfAborted();
        progress({ message: 'Building the 3D view…' });
        const loader = source.format === 'xgf' ? new XGFLoader() : new GLTFLoader();
        must(
          await loader.load(
            { sceneModel: model, fileData: data },
            {
              signal: combined,
              baseUri: new URL('.', source.url).href,
              yieldIntervalMs: 20,
              ...(source.format !== 'xgf'
                ? {
                    coordinateSystem: {
                      basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
                      origin: [0, 0, 0],
                      units: 'meters' as const,
                    },
                  }
                : {}),
              onProgress: ({ phase, current, total }) =>
                progress({ message: phase + '…', current, total }),
            },
          ),
        );
        combined.throwIfAborted();
        if (!Object.keys(model.meshes).length)
          throw new Error('This model contains no viewable geometry.');
        must(model.seal());
        this.camera.setModel(model);
      }
      await textures.check();
      combined.throwIfAborted();
      progress({ message: 'Drawing the model…' });
      await this.firstFrame(combined);
    })();
    this.loading = task;
    try {
      await task;
    } finally {
      if (this.loading === task) this.loading = undefined;
    }
  }
  private firstFrame(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let stop = () => {};
      const finish = (error?: unknown) => {
        clearTimeout(timeout);
        stop();
        signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(signal.reason);
      const timeout = setTimeout(
        () =>
          finish(
            new Error('The graphics device did not finish drawing. Try opening the preview again.'),
          ),
        60000,
      );
      stop = this.renderer!.events.onViewRendered.subscribe((_renderer, view) => {
        if (view === this.view) finish();
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else this.view.needsRender();
    });
  }
  async unload() {
    this.modeGeneration++;
    this.abort?.abort();
    const streaming = this.stream;
    this.stream = undefined;
    await streaming?.destroy();
    await this.loading?.catch(() => undefined);
    await this.rendering?.reset();
    this.model?.destroy();
    this.model = undefined;
    this.camera.clear();
    this.view.needsRender();
  }
  async setMode(mode: PreviewMode) {
    const generation = ++this.modeGeneration;
    await this.stream?.pause(mode === 'rayTracing' || mode === 'pathTracing');
    if (generation !== this.modeGeneration || this.disposed) return;
    try {
      await this.rendering?.setMode(mode);
    } catch (error) {
      if (generation === this.modeGeneration) await this.stream?.pause(false);
      throw error;
    }
  }
  setEffect(effect: PreviewEffect, enabled: boolean) {
    this.rendering?.setEffect(effect, enabled);
  }
  fit() {
    this.camera.fit();
  }
  async destroy() {
    if (this.disposed) return;
    this.disposed = true;
    await this.unload();
    await this.rendering?.destroy();
    this.stops.splice(0).forEach((stop) => stop());
    this.resize.disconnect();
    this.navigation?.destroy();
    this.camera.destroy();
    this.renderer?.destroy();
    this.viewer.destroy();
    this.scene.destroy();
    this.canvas.remove();
  }
}
