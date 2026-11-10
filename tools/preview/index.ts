import type { PreviewEngineOptions } from '../../app/preview/types';
import { XeokitPreviewEngine } from './XeokitPreviewEngine';

export async function createPreviewEngine(options: PreviewEngineOptions) {
  if ('gpu' in navigator) {
    try {
      return await XeokitPreviewEngine.create(options, 'webgpu');
    } catch {

      /*
       * WebGL keeps previews available when WebGPU is unavailable.
       */
    }
  }
  return XeokitPreviewEngine.create(options, 'webgl');
}
