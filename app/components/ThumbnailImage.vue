<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';

const props = defineProps<{
  src?: string;
  alt: string;
  width?: number;
  height?: number;
  crossorigin?: 'anonymous' | 'use-credentials';
}>();
const image = ref<HTMLImageElement>();
const loaded = ref(false),
  failed = ref(false);
const loading = computed(() => !!props.src && !loaded.value && !failed.value);

// Only a new image starts another loading cycle. Updating a title does not.
watch(
  () => props.src,
  () => {
    loaded.value = false;
    failed.value = false;
  },
);
function finish(event: Event, success: boolean) {
  // A result from a replaced image must not finish the current preview.
  if (event.target !== image.value) return;
  loaded.value = success;
  failed.value = !success;
}
</script>
<template>
  <div class="thumbnail-image" :aria-busy="loading">
    <img
      v-if="src && !failed"
      :key="src"
      ref="image"
      :src="src"
      :alt="alt"
      :width="width"
      :height="height"
      :crossorigin="crossorigin"
      :class="{ 'thumbnail-image-pending': loading }"
      loading="lazy"
      decoding="async"
      @load="finish($event, true)"
      @error="finish($event, false)"
    />
    <div v-if="loading" class="thumbnail-loading" role="status" aria-label="Loading preview">
      <ElIcon class="is-loading" :size="24" aria-hidden="true"><Loading /></ElIcon>
    </div>
    <slot v-if="!src || failed" />
  </div>
</template>
<style scoped>
.thumbnail-image {
  position: relative;
}
.thumbnail-image-pending {
  opacity: 0;
}
.thumbnail-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--el-color-primary);
  background: var(--app-preview);
  pointer-events: none;
}
</style>
