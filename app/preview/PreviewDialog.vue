<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElDialog, ElIcon, ElSwitch } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { Maximize } from 'lucide-vue-next';
import { usePreview } from './store';
import type { PreviewMode, PreviewEffect } from './types';
import './preview.css';
const preview = usePreview(),
  parking = ref<HTMLElement>(),
  viewport = ref<HTMLElement>();
const modes: { id: PreviewMode; label: string }[] = [
  { id: 'engineering', label: 'Engineering' },
  { id: 'pbr', label: 'PBR' },
  { id: 'rayTracing', label: 'Ray trace' },
  { id: 'pathTracing', label: 'Path trace' },
];
const effects: { id: PreviewEffect; label: string }[] = [
  { id: 'textures', label: 'Textures' },
  { id: 'edges', label: 'Edges' },
  { id: 'sao', label: 'Ambient occlusion' },
  { id: 'shadows', label: 'Shadows' },
];
const tracing = computed(() => ['rayTracing', 'pathTracing'].includes(preview.state.mode));
const progressValue = computed(() => {
  const { current, total } = preview.state.progress;
  return total && current !== undefined
    ? Math.min(100, Math.round((current / total) * 100))
    : undefined;
});
let idle: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
async function mountCanvas() {
  await nextTick();
  if (viewport.value && preview.state.open) preview.controller.mount(viewport.value);
}
watch(
  () => preview.state.open,
  () => {
    void mountCanvas();
  },
  { flush: 'post' },
);
onMounted(() => {
  preview.controller.park(parking.value!);
  const warm = () => {
    void preview.controller.warm().catch(() => undefined);
  };
  if ('requestIdleCallback' in window) idle = window.requestIdleCallback(warm, { timeout: 2500 });
  else timer = setTimeout(warm, 800);
});
onBeforeUnmount(() => {
  if (idle !== undefined) window.cancelIdleCallback(idle);
  clearTimeout(timer);
  void preview.controller.destroy();
});
function onVisible(value: boolean) {
  if (!value) preview.controller.close();
}
function retry() {
  if (preview.state.model) void preview.controller.open(preview.state.model);
}
</script>
<template>
  <div ref="parking" class="preview-parking" aria-hidden="true" inert />
  <ElDialog
    :model-value="preview.state.open"
    :title="(preview.state.model?.metadata.name ?? 'Model') + ' · 3D preview'"
    class="model-preview-dialog"
    width="min(1200px, 96vw)"
    top="3vh"
    append-to-body
    :close-on-click-modal="false"
    :destroy-on-close="false"
    @update:model-value="onVisible"
    @open="mountCanvas"
    @opened="preview.controller.fit()"
  >
    <div class="preview-toolbar">
      <div class="preview-modes" role="group" aria-label="Rendering style">
        <button
          v-for="mode in modes"
          :key="mode.id"
          :aria-pressed="preview.state.mode === mode.id"
          :disabled="preview.state.phase !== 'ready'"
          @click="preview.controller.setMode(mode.id)"
        >
          {{ mode.label }}
        </button>
      </div>
      <el-button :disabled="preview.state.phase !== 'ready'" @click="preview.controller.fit()"
        ><Maximize :size="15" />Fit model</el-button
      >
    </div>
    <div class="preview-effects" role="group" aria-label="Rendering effects">
      <label v-for="effect in effects" :key="effect.id"
        ><ElSwitch
          :model-value="preview.state.effects[effect.id]"
          :aria-label="effect.label"
          :disabled="preview.state.phase !== 'ready' || preview.state.switching || tracing"
          @update:model-value="(value) => preview.controller.setEffect(effect.id, Boolean(value))"
        />{{ effect.label }}</label
      >
    </div>
    <div class="preview-stage" :aria-busy="preview.state.phase === 'loading'">
      <div ref="viewport" class="preview-viewport" />
      <div
        v-if="preview.state.phase === 'loading'"
        class="preview-overlay"
        role="status"
        aria-live="polite"
      >
        <ElIcon class="is-loading"><Loading /></ElIcon>
        <strong>{{ preview.state.progress.message || 'Loading model…' }}</strong>
        <progress aria-label="Model loading progress" :value="progressValue" max="100" />
        <span v-if="progressValue !== undefined">{{ progressValue }}%</span>
        <el-button @click="preview.controller.cancel()">Cancel loading</el-button>
      </div>
      <div
        v-else-if="preview.state.phase === 'error' || preview.state.phase === 'cancelled'"
        class="preview-overlay"
      >
        <p :role="preview.state.phase === 'error' ? 'alert' : 'status'">
          {{ preview.state.error || 'Loading cancelled.' }}
        </p>
        <div class="preview-retry">
          <el-button @click="retry">Try again</el-button
          ><el-button @click="preview.controller.close()">Close</el-button>
        </div>
      </div>
      <div v-else-if="preview.state.progress.message" class="preview-stream-progress" role="status">
        <ElIcon class="is-loading"><Loading /></ElIcon>{{ preview.state.progress.message }}
        <el-button @click="preview.controller.cancel()">Cancel</el-button>
      </div>
    </div>
    <div class="preview-footer">
      <span>Drag to orbit · Right-drag to pan · Scroll to zoom</span>
      <span role="status" class="preview-render-status"
        ><ElIcon v-if="preview.state.switching" class="is-loading"><Loading /></ElIcon
        >{{ preview.state.rendering }}</span
      >
    </div>
  </ElDialog>
</template>
