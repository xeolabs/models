<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { computed } from 'vue';
import type {
  ProviderModelSummary,
  ProviderDownload,
  ProviderDownloadSummary,
} from '../../src/providers/types.js';
import { packageBytes, matchingDownloads } from '../stores/providerStatistics';
const props = defineProps<{
  model: ProviderModelSummary;
  downloads?: (ProviderDownload | ProviderDownloadSummary)[];
  error?: string;
  format: string;
  resolution: string;
  maxBytes?: number;
}>();
const bytes = (size: number | undefined) =>
  size === undefined
    ? 'Unknown'
    : size < 1024 ** 2
      ? (size / 1024).toFixed(1) + ' KiB'
      : (size / 1024 ** 2).toFixed(1) + ' MiB';
const options = computed(() =>
  props.downloads
    ? matchingDownloads(props.downloads, {
        format: props.format,
        resolution: props.resolution,
        maxBytes: props.maxBytes,
        tag: '',
      })
    : undefined,
);
const range = computed(() => {
  const values = (options.value ?? [])
    .map(packageBytes)
    .filter((size): size is number => size !== undefined);
  if (!values.length) return 'Unknown';
  const low = Math.min(...values),
    high = Math.max(...values);
  return bytes(low) + (low === high ? '' : ' – ' + bytes(high));
});
const formats = computed(() =>
  [...new Set((options.value ?? []).map((d) => modelFormatLabel(d.format)))].join(', '),
);
const resolutions = computed(() =>
  [...new Set((options.value ?? []).map((d) => d.resolution.toUpperCase()))].join(', '),
);
</script>
<template>
  <div class="model-statistics">
    <dl>
      <dt>Polygons</dt>
      <dd>{{ model.statistics?.polygonCount?.toLocaleString() ?? 'Not supplied' }}</dd>
      <dt>Download</dt>
      <dd>{{ downloads ? range : error ? 'Unavailable' : 'Checking…' }}</dd>
      <dt>Formats</dt>
      <dd>{{ downloads ? formats || 'None supported' : 'Checking…' }}</dd>
      <dt>Sizes / variants</dt>
      <dd>{{ downloads ? resolutions || 'Not supplied' : 'Checking…' }}</dd>
    </dl>
    <p v-if="error" class="remote-warning">Sizes unavailable: {{ error }}</p>
    <details v-if="options?.length">
      <summary>{{ options.length }} download options · includes supporting files</summary>
      <div class="download-options-table">
        <table>
          <thead>
            <tr>
              <th>Format</th>
              <th>Size / variant</th>
              <th>Package</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="option in options" :key="option.id">
              <td>{{ modelFormatLabel(option.format) }}</td>
              <td>{{ option.resolution.toUpperCase() }}</td>
              <td>{{ bytes(packageBytes(option)) }}</td>
              <td>{{ 'files' in option ? option.files.length : (option.fileCount ?? '—') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
    <p v-if="model.statistics?.hasLods" class="section-note">Level-of-detail variants available</p>
  </div>
</template>
