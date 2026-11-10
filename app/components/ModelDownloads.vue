<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import ModelLoadUrl from './ModelLoadUrl.vue';
import { modelHotloadUrl } from '../../src/browser/modelFileUrls';
import type {
  AvailableModelFormats,
  ModelRepresentationFormat,
} from '../../src/conversion/ModelFormats';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { Download } from 'lucide-vue-next';
import { change, modelUrl, request } from '../data/CatalogApi';
import type { ConversionFormat, ConvertedModel } from '../../src/conversion/types';

const props = defineProps<{ modelId: string }>();
const formats = ref<AvailableModelFormats | null>(null);
const selected = ref<ModelRepresentationFormat>();
const loading = ref(false);
const generating = ref(false);
const error = ref('');
let generation = 0;
const option = computed(() =>
  formats.value?.formats.find((item) => item.format === selected.value),
);
const loadUrl = computed(() =>
  option.value
    ? modelHotloadUrl(location.origin, props.modelId, option.value.format, option.value.entrypoint)
    : '',
);
const bytes = (value: number) =>
  value > 1024 ** 2 ? (value / 1024 ** 2).toFixed(1) + ' MB' : Math.ceil(value / 1024) + ' KB';

/**
 * Ignore responses for an older selection, including a conversion that finishes
 * after the user has moved to a different model.
 */
async function load() {
  const version = ++generation;
  formats.value = null;
  selected.value = undefined;
  loading.value = true;
  generating.value = false;
  error.value = '';
  try {
    const result = await request<AvailableModelFormats>(modelUrl(props.modelId) + '/formats');
    if (version !== generation) return;
    formats.value = result;
    selected.value =
      result.formats.find((item) => item.format === 'glb')?.format ?? result.formats[0]?.format;
  } catch (cause) {
    if (version === generation)
      error.value = cause instanceof Error ? cause.message : 'Could not check download formats.';
  } finally {
    if (version === generation) loading.value = false;
  }
}
async function download() {
  if (!selected.value || generating.value || option.value?.source !== 'converted') return;
  const version = generation,
    format = selected.value as ConversionFormat;
  const url = modelUrl(props.modelId) + '/conversions/' + format;
  generating.value = true;
  error.value = '';
  try {
    const result = await change<ConvertedModel>(url, 'POST');
    if (version !== generation) return;
    const current = formats.value?.formats.find((item) => item.format === format);
    if (current) {
      current.cached = true;
      current.bytes = result.files.reduce((sum, file) => sum + file.bytes, 0);
      current.warnings = result.warnings;
    }
    const link = document.createElement('a');
    // DataModel is useful on its own. The full package still retains source notices.
    link.href =
      format === 'datamodel'
        ? modelUrl(props.modelId) +
          '/formats/datamodel/files/' +
          encodeURIComponent(result.entrypoint) +
          '?download=1'
        : url + '/download';
    link.download = format === 'datamodel' ? result.entrypoint : '';
    document.body.append(link);
    link.click();
    link.remove();
  } catch (cause) {
    if (version === generation)
      error.value = cause instanceof Error ? cause.message : 'Could not prepare this download.';
  } finally {
    if (version === generation) generating.value = false;
  }
}
watch(() => props.modelId, load, { immediate: true });
onBeforeUnmount(() => generation++);
</script>
<template>
  <section class="detail-section conversion-downloads" :aria-busy="loading || generating">
    <h2>Model format</h2>
    <p v-if="loading" class="format-loading" role="status">
      <ElIcon class="is-loading"><Loading /></ElIcon>Checking available formats…
    </p>
    <template v-else-if="formats?.formats.length">
      <label
        >Format
        <el-select v-model="selected" :disabled="generating" aria-label="Model format">
          <el-option
            v-for="item in formats.formats"
            :key="item.format"
            :value="item.format"
            :label="
              modelFormatLabel(item.format) +
              (item.source === 'original' ? ' · Original' : item.cached ? ' · Ready' : '')
            "
          />
        </el-select>
      </label>
      <ModelLoadUrl v-if="option" :url="loadUrl" :format="option.format" />
      <p v-if="option?.cached">
        {{ option.source === 'original' ? 'Original files' : 'Cached download'
        }}<span v-if="option.bytes !== undefined"> · {{ bytes(option.bytes) }}</span>
      </p>
      <ul v-if="option?.warnings.length" class="conversion-notices">
        <li v-for="notice in option.warnings" :key="notice">{{ notice }}</li>
      </ul>
      <el-button
        v-if="option?.source === 'converted'"
        class="format-download"
        type="primary"
        :loading="generating"
        :disabled="!selected"
        @click="download"
        ><Download v-if="!generating" :size="14" />{{
          generating
            ? 'Preparing download…'
            : selected === 'datamodel'
              ? 'Download JSON'
              : option?.cached
                ? 'Download'
                : 'Generate and download'
        }}</el-button
      >
    </template>
    <p v-else-if="formats">No model files are available.</p>
    <p v-for="notice in formats?.warnings" :key="notice">{{ notice }}</p>
    <p v-if="error" role="alert">{{ error }} The original package is still available.</p>
    <el-button v-if="error && !formats" @click="load">Retry</el-button>
  </section>
</template>
<style scoped>
.conversion-downloads label {
  display: grid;
  gap: 6px;
}
.conversion-downloads .el-select {
  width: 100%;
}
.format-loading {
  display: flex;
  gap: 8px;
  align-items: center;
}
.conversion-notices {
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.5;
}
.conversion-notices li + li {
  margin-top: 6px;
}
</style>
