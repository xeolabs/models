<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { Box } from 'lucide-vue-next';
import ThumbnailImage from './ThumbnailImage.vue';
import { request } from '../data/http';
import { useProcessing } from '../stores/processing';
const props = defineProps<{ modelId: string; name: string }>();
const processing = useProcessing(),
  url = ref<string>();
let controller: AbortController | undefined;
const pending = computed(
  () =>
    !url.value &&
    processing.overview?.jobs.some(
      (job) =>
        job.modelId === props.modelId && ['queued', 'running', 'cancelling'].includes(job.status),
    ),
);
async function refresh() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  try {
    const status = await request<{ ready: boolean; url?: string }>(
      '/api/models/' + encodeURIComponent(props.modelId) + '/thumbnail/status',
      current.signal,
    );
    if (controller === current) url.value = status.url;
  } catch {

    /*
     * A failed preview leaves the model card usable.
     */
  }
}
// Queue completion updates existing cards without refetching model metadata.
watch([() => props.modelId, () => processing.overview?.counts.completed], () => void refresh(), {
  immediate: true,
});
onBeforeUnmount(() => controller?.abort());
</script>
<template>
  <ThumbnailImage class="model-preview" :src="url" :alt="name">
    <div
      v-if="pending"
      class="ifc-preview-pending"
      role="status"
      aria-label="Preparing model preview"
    >
      <ElIcon class="is-loading" :size="24"><Loading /></ElIcon>
    </div>
    <div v-else class="preview-fallback"><Box :size="42" /><span>IFC</span></div>
  </ThumbnailImage>
</template>
<style scoped>
.ifc-preview-pending {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--el-color-primary);
}
</style>
