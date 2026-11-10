import type { ModelRecord } from '../../src/domain/types.js';
import type { PreviewMode, PreviewEffect, PreviewProgress } from './PreviewEngine';
export * from './PreviewEngine';

export interface PreviewState {
  open: boolean;
  model: ModelRecord | null;
  phase: 'idle' | 'loading' | 'ready' | 'cancelled' | 'error';
  progress: PreviewProgress;
  error: string;
  mode: PreviewMode;
  effects: Record<PreviewEffect, boolean>;
  rendering: string;
  switching: boolean;
}
export const defaultEffects = (): Record<PreviewEffect, boolean> => ({
  textures: false,
  edges: false,
  sao: false,
  shadows: false,
});
export const initialPreviewState = (): PreviewState => ({
  open: false,
  model: null,
  phase: 'idle',
  progress: { message: '' },
  error: '',
  mode: 'engineering',
  effects: defaultEffects(),
  rendering: '',
  switching: false,
});
