<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { ElButton, ElOption, ElSelect } from 'element-plus';
import { request } from '../data/http';
import { change } from '../data/CatalogApi';
import { useProcessing } from '../stores/processing';
import type { ModelPropertiesInfo, PropertySetMode } from '../../src/properties/types';

const props = defineProps<{ modelId: string }>();
const processing = useProcessing();
const info = ref<ModelPropertiesInfo>();
const mode = ref<PropertySetMode>('embedded');
const busy = ref(false);
const error = ref('');
let pending: AbortController | undefined;
const working = computed(
  () =>
    processing.overview?.jobs.some(
      (job) =>
        job.modelId === props.modelId && ['queued', 'running', 'cancelling'].includes(job.status),
    ) ?? false,
);
const endpoint = computed(() => '/api/models/' + encodeURIComponent(props.modelId));

async function refresh() {
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  try {
    const value = await request<ModelPropertiesInfo>(
      endpoint.value + '/properties',
      controller.signal,
    );
    if (controller.signal.aborted) return;
    info.value = value;
    mode.value = value.mode;
    error.value = '';
  } catch (cause) {
    if (!controller.signal.aborted)
      error.value = cause instanceof Error ? cause.message : String(cause);
  }
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await change(endpoint.value + '/properties', 'PATCH', { mode: mode.value });
    await processing.refresh();
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    mode.value = info.value?.mode ?? 'embedded';
  } finally {
    busy.value = false;
  }
}
watch(
  () => props.modelId,
  () => {
    info.value = undefined;
    void refresh();
  },
  { immediate: true },
);
watch(
  () =>
    processing.overview?.jobs
      .filter((job) => job.modelId === props.modelId)
      .map((job) => `${job.id}:${job.status}`)
      .join('|'),
  () => {
    if (!working.value) void refresh();
  },
);
onUnmounted(() => pending?.abort());
</script>
<template>
  <section class="detail-section model-properties">
    <h2>Properties</h2>
    <label
      >Storage<el-select
        v-model="mode"
        :disabled="!info || busy || working"
        aria-label="Property storage"
      >
        <el-option value="embedded" label="Include in DataModel JSON" />
        <el-option value="external" label="Store on server" /> </el-select
    ></label>
    <el-button v-if="info && mode !== info.mode" :loading="busy" :disabled="working" @click="save"
      >Apply</el-button
    >
    <p v-if="working" role="status">Processing properties…</p>
    <p v-else-if="info?.mode === 'external'">
      {{
        info.ready
          ? `${info.propertySetCount?.toLocaleString()} property sets ready`
          : 'Available after IFC preparation'
      }}
    </p>
    <a
      v-if="info?.mode === 'external' && info.ready"
      class="download-button"
      :href="endpoint + '/datamodel?properties=embedded&download=1'"
      >Download full DataModel</a
    >
    <p v-if="error" role="alert" class="acquisition-error">{{ error }}</p>
  </section>
</template>
<style scoped>
.model-properties label {
  display: grid;
  gap: 6px;
  margin-bottom: 10px;
}
.model-properties :deep(.el-select) {
  width: 100%;
}
</style>
