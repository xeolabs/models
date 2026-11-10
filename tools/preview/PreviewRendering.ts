import { getSceneCollisionIndex } from '@xeokit/sdk/spatial/collision';
import type { View } from '@xeokit/sdk/viewing/viewer';
import { ViewProfiles, type ViewProfile } from '@xeokit/sdk/viewing/profiles';
import type { WebGLRenderer } from '@xeokit/sdk/viewing/renderers/webGL';
import type { WebGPURenderer } from '@xeokit/sdk/viewing/renderers/webGPU';
import type { PreviewMode, PreviewEffect } from '../../app/preview/types';

const engineering: ViewProfile = {
  texturing: { enabled: false },
  edges: { enabled: false, edgeWidth: 1, edgeAlpha: 0.55, useMeshColor: true },
  hemispheric: { enabled: true, intensity: 0.8, worldUp: [0, 0, 1] },
  antiAliasing: { enabled: true, mode: 'fxaa' },
  tonemap: { enabled: false },
};
const pbr: ViewProfile = {
  texturing: { enabled: true },
  ibl: { enabled: true, intensity: 1 },
  hemispheric: { enabled: true, intensity: 0.12, worldUp: [0, 0, 1] },
  antiAliasing: { enabled: true, mode: 'fxaa' },
  tonemap: { enabled: true, mode: 'aces', exposure: 1, sRGBEncode: true },
};

/**
 * Tracing modules load only after an explicit choice. Camera movement temporarily
 * uses raster rendering, and closing releases the tracing acceleration structures.
 */
export class PreviewRendering {
  private readonly profiles: ViewProfiles;
  private readonly registrations = new Map<string, () => void>();
  private requested: PreviewMode = 'engineering';
  private generation = 0;
  private navigating = false;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly stops: (() => void)[] = [];
  private disposed = false;
  constructor(
    private readonly renderer: WebGLRenderer | WebGPURenderer,
    private readonly view: View,
    private readonly backend: 'webgl' | 'webgpu',
    private readonly report: (message: string) => void,
  ) {
    this.profiles = new ViewProfiles(view, {
      profiles: { engineering, pbr },
      activeProfile: 'engineering',
    });
    const moved = (sender: unknown) => {
      if (sender === view || sender === view.camera) this.moving();
    };
    this.stops.push(
      view.viewer.events.onCameraViewMatrixUpdated.subscribe(moved),
      view.viewer.events.onCameraProjMatrixUpdated.subscribe(moved),
    );
  }
  async setMode(mode: PreviewMode) {
    const generation = ++this.generation;
    this.requested = mode;
    this.navigating = false;
    clearTimeout(this.timer);
    await this.renderer.setTechnique(this.view, 'raster');
    if (this.disposed || generation !== this.generation) return;
    mustProfile(this.profiles.setActiveProfile(null));
    mustProfile(this.profiles.setActiveProfile(mode === 'engineering' ? 'engineering' : 'pbr'));
    if (mode === 'engineering' || mode === 'pbr') {
      this.report('');
      return;
    }
    this.report(mode === 'pathTracing' ? 'Preparing path tracing…' : 'Preparing ray tracing…');
    try {
      if (!this.registrations.has(mode)) {
        const technique =
          mode === 'pathTracing' ? await this.pathTechnique() : await this.rayTechnique();
        if (this.disposed || generation !== this.generation) return;
        this.registrations.set(
          mode,
          technique.backend === 'webgpu'
            ? (this.renderer as WebGPURenderer).techniques.register(technique.value)
            : (this.renderer as WebGLRenderer).techniques.register(technique.value),
        );
      }
      const selected = await this.renderer.setTechnique(this.view, mode);
      if (this.disposed || generation !== this.generation) return;
      const status = this.renderer.techniques.getStatus(this.view);
      if (this.navigating) return;
      if (!selected || status.active !== mode)
        throw (
          status.error ??
          new Error('This model or graphics device does not support that rendering mode.')
        );
      this.report('');
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      await this.reset();
      throw error;
    }
  }
  private async rayTechnique() {
    const bounds = getSceneCollisionIndex(this.view.viewer.scene!).getSceneAABB();
    const lighting = bounds
      ? {
          center: [
            (bounds[0] + bounds[3]) / 2,
            (bounds[1] + bounds[4]) / 2,
            (bounds[2] + bounds[5]) / 2,
          ] as [number, number, number],
          scale: Math.max(
            0.1,
            Math.hypot(bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]) / 12,
          ),
        }
      : undefined;
    const options = {
      textureSize: 1024 as const,
      lighting,
      settings: {
        pbr: true,
        textures: true,
        smoothShading: true,
        transparency: true,
        shadows: true,
        bounces: 2,
        antialiasing: '4x' as const,
      },
    };
    if (this.backend === 'webgpu')
      return {
        backend: 'webgpu' as const,
        value: (
          await import('@xeokit/sdk/viewing/techniques/rayTracing/webGPU')
        ).webgpuRayTracingTechnique(options),
      };
    return {
      backend: 'webgl' as const,
      value: (
        await import('@xeokit/sdk/viewing/techniques/rayTracing/webGL')
      ).webglRayTracingTechnique(options),
    };
  }
  private async pathTechnique() {
    const sdk = await import('@xeokit/sdk/viewing/techniques/pathTracing');
    const options = { preset: 'preview' as const, textureSize: 1024 as const };
    return this.backend === 'webgpu'
      ? { backend: 'webgpu' as const, value: sdk.webgpuPathTracingTechnique(options) }
      : { backend: 'webgl' as const, value: sdk.webglPathTracingTechnique(options) };
  }
  private moving() {
    if (this.requested === 'engineering' || this.requested === 'pbr' || this.disposed) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.navigating = true;
    void this.renderer.setTechnique(this.view, 'raster');
    this.report('Interactive preview while navigating');
    this.timer = setTimeout(() => {
      if (generation !== this.generation || this.disposed) return;
      this.navigating = false;
      void this.renderer
        .setTechnique(this.view, this.requested)
        .then((selected) => {
          if (generation === this.generation)
            this.report(selected ? '' : 'Tracing is unavailable for this view.');
        })
        .catch(() => this.report('Tracing is unavailable for this view.'));
    }, 500);
  }
  setEffect(effect: PreviewEffect, enabled: boolean) {
    if (effect === 'textures') this.view.texturing.enabled = enabled;
    else this.view.effects[effect].enabled = enabled;
    this.view.needsRender();
  }
  async reset() {
    this.generation++;
    this.requested = 'engineering';
    clearTimeout(this.timer);
    await this.renderer.setTechnique(this.view, 'raster');
    for (const unregister of this.registrations.values()) unregister();
    this.registrations.clear();
    mustProfile(this.profiles.setActiveProfile(null));
    mustProfile(this.profiles.setActiveProfile('engineering'));
    this.report('');
  }
  async destroy() {
    this.disposed = true;
    await this.reset();
    this.stops.splice(0).forEach((stop) => stop());
    mustProfile(this.profiles.setActiveProfile(null));
  }
}
function mustProfile(result: { ok: boolean; error?: string }) {
  if (!result.ok) throw new Error(result.error);
}
