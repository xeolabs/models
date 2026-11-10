import { defineStore } from 'pinia';
import { shallowRef, markRaw } from 'vue';
import { PreviewController } from './PreviewController';
import { initialPreviewState } from './types';

/**
 * The SDK is a separate browser chunk. Browsing the catalog never waits for it.
 */
export const usePreview = defineStore('preview', () => {
  const state = shallowRef(initialPreviewState());
  const controller = markRaw(
    new PreviewController(
      async (options) => {
        const { createPreviewEngine } = await import('../../vendor/xeokit/preview/index.js');
        return createPreviewEngine(options);
      },
      (value) => {
        state.value = value;
      },
    ),
  );
  return { state, controller };
});
