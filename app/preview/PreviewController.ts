import type { ModelRecord } from '../../src/domain/types.js';
import { PreviewSourceResolver } from './PreviewSourceResolver';
import {
  defaultEffects,
  initialPreviewState,
  type CreatePreviewEngine,
  type PreviewEngine,
  type PreviewState,
  type PreviewMode,
  type PreviewEffect,
} from './types';

/**
 * One renderer lives for the app's lifetime. Each opening has its own cancellation
 * signal, and old work must finish cleaning up before another model enters it.
 */
export class PreviewController {
  private state = initialPreviewState();
  private engine?: PreviewEngine;
  private warming?: Promise<PreviewEngine>;
  private request?: AbortController;
  private generation = 0;
  private modeGeneration = 0;
  private automaticAppearance = true;
  private tail: Promise<unknown> = Promise.resolve();
  private host?: HTMLElement;
  private parking?: HTMLElement;
  private disposed = false;

  constructor(
    private readonly create: CreatePreviewEngine,
    private readonly publish: (state: PreviewState) => void,
    private readonly sources = new PreviewSourceResolver(),
  ) {}

  park(host: HTMLElement) {
    this.parking = host;
    if (!this.state.open) this.mount(host);
  }
  mount(host: HTMLElement) {
    this.host = host;
    this.engine?.mount(host, this.state.open);
  }

  warm(): Promise<PreviewEngine> {
    if (this.disposed) return Promise.reject(new Error('Preview is closed.'));
    if (!this.warming) {
      this.warming = this.create({
        onRendering: (message) => {
          if (this.state.open) this.change({ rendering: message });
        },
        onError: (error) => {
          if (this.state.open) {
            this.cancel();
            this.change({ phase: 'error', error: error.message });
          }
        },
      })
        .then(async (engine) => {
          if (this.disposed) {
            await engine.destroy();
            throw new Error('Preview is closed.');
          }
          this.engine = engine;
          if (this.host) engine.mount(this.host, this.state.open);
          return engine;
        })
        .catch((error) => {
          this.warming = undefined;
          throw error;
        });
    }
    return this.warming;
  }

  async open(model: ModelRecord): Promise<void> {
    if (this.disposed) return;
    this.request?.abort();
    const request = (this.request = new AbortController()),
      generation = ++this.generation;
    this.modeGeneration++;
    this.automaticAppearance = true;
    this.change({
      ...initialPreviewState(),
      open: true,
      model,
      phase: 'loading',
      progress: { message: 'Starting the viewer…' },
    });
    const active = () =>
      !this.disposed && generation === this.generation && !request.signal.aborted;
    const progress = (value: PreviewState['progress']) => {
      if (active()) this.change({ progress: value });
    };
    // Cancelled or replaced openings still settle here, so stale callbacks cannot
    // display a model or destroy the model that follows it.
    const work = this.tail
      .catch(() => undefined)
      .then(async () => {
        if (!active()) return;
        try {
          const engine = await this.warm();
          if (!active()) return;
          await engine.unload();
          if (this.host) engine.mount(this.host, true);
          const source = await this.sources.resolve(model, request.signal, progress);
          if (!active()) return;
          await engine.load(source, request.signal, progress, async () => {
            // A stream may reveal its first texture after the initial view is ready.
            // Once the user changes the view, later chunks must respect that choice.
            if (!active() || !this.automaticAppearance) return;
            this.automaticAppearance = false;
            await this.changeMode('pbr');
          });
          if (active()) this.change({ phase: 'ready', progress: { message: '' } });
        } catch (error) {
          await this.engine?.unload().catch(() => undefined);
          if (active())
            this.change({
              phase: 'error',
              error: error instanceof Error ? error.message : 'Could not load this model.',
            });
        }
      });
    this.tail = work.catch(() => undefined);
    await work;
  }

  cancel(): void {
    this.request?.abort();
    this.generation++;
    this.modeGeneration++;
    this.automaticAppearance = false;
    this.change({ phase: 'cancelled', progress: { message: '' }, switching: false, rendering: '' });
    this.cleanup();
  }
  close(): void {
    this.request?.abort();
    this.generation++;
    this.modeGeneration++;
    this.change(initialPreviewState());
    if (this.parking) this.mount(this.parking);
    this.cleanup();
  }
  private cleanup() {
    // Aborting stops fetches immediately; unloading waits for any SDK parser to yield.
    const cleanup = this.tail.catch(() => undefined).then(() => this.engine?.unload());
    this.tail = cleanup.catch(() => undefined);
  }
  async setMode(mode: PreviewMode) {
    if (this.state.phase !== 'ready' || !this.engine) return;
    this.automaticAppearance = false;
    await this.changeMode(mode);
  }
  private async changeMode(mode: PreviewMode) {
    const generation = ++this.modeGeneration;
    const effects =
      mode === 'engineering'
        ? defaultEffects()
        : { textures: true, edges: false, sao: false, shadows: false };
    this.change({ mode, effects, switching: true, rendering: '' });
    try {
      await this.engine!.setMode(mode);
    } catch (error) {
      if (generation === this.modeGeneration)
        this.change({
          mode: 'engineering',
          effects: defaultEffects(),
          rendering: error instanceof Error ? error.message : 'Rendering mode unavailable.',
        });
    } finally {
      if (generation === this.modeGeneration) this.change({ switching: false });
    }
  }
  setEffect(effect: PreviewEffect, enabled: boolean) {
    if (this.state.phase !== 'ready' || this.state.switching) return;
    this.automaticAppearance = false;
    this.engine?.setEffect(effect, enabled);
    this.change({ effects: { ...this.state.effects, [effect]: enabled } });
  }
  fit() {
    if (this.state.phase === 'ready') this.engine?.fit();
  }
  private change(patch: Partial<PreviewState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.publish(this.state);
  }
  async destroy() {
    this.close();
    this.disposed = true;
    await this.tail;
    await this.engine?.destroy();
  }
}
