export type PreviewMode = 'engineering' | 'pbr' | 'rayTracing' | 'pathTracing';
export type PreviewFormat = 'xgf' | 'xgfstream' | 'glb' | 'gltf';
export type PreviewEffect = 'textures' | 'edges' | 'sao' | 'shadows';
export interface PreviewProgress {
  message: string;
  current?: number;
  total?: number;
}
export interface PreviewSource {
  format: PreviewFormat;
  url: string;
}

/**
 * The app owns requests and the dialog. The SDK adapter owns graphics resources.
 * Keeping this boundary small lets lifecycle tests run without a graphics device.
 */
export interface PreviewEngine {
  mount(host: HTMLElement, active: boolean): void;
  load(
    source: PreviewSource,
    signal: AbortSignal,
    progress: (value: PreviewProgress) => void,
    onTextures: () => Promise<void>,
  ): Promise<void>;
  unload(): Promise<void>;
  setMode(mode: PreviewMode): Promise<void>;
  setEffect(effect: PreviewEffect, enabled: boolean): void;
  fit(): void;
  destroy(): Promise<void>;
}
export interface PreviewEngineOptions {
  onRendering(message: string): void;
  onError(error: Error): void;
}
export type CreatePreviewEngine = (options: PreviewEngineOptions) => Promise<PreviewEngine>;
