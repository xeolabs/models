<script setup lang="ts">
import { computed } from 'vue';
import ThumbnailImage from './ThumbnailImage.vue';
import { ImageOff } from 'lucide-vue-next';
import type { ProviderModelSummary } from '../../src/providers/types.js';
const props = defineProps<{ model: ProviderModelSummary }>();
const source = computed(() =>
  props.model.previewUrl || props.model.provider === 'smithsonian'
    ? `/api/acquisition/models/${props.model.provider}/${encodeURIComponent(props.model.remoteId)}/preview`
    : undefined,
);
</script>
<template>
  <ThumbnailImage
    class="provider-thumbnail"
    :src="source"
    :alt="`Preview of ${model.name}`"
    :width="112"
    :height="112"
  >
    <div class="provider-thumbnail-fallback">
      <ImageOff :size="22" aria-hidden="true" />
      <span>{{ source ? 'Preview unavailable' : 'No preview' }}</span>
    </div>
  </ThumbnailImage>
</template>
