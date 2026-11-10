<script setup lang="ts">
import { useProcessing } from '../stores/processing';
const processing = useProcessing();
import { modelFormatLabel } from '../modelFormatLabel';
import ModelProperties from './ModelProperties.vue';
import ModelDownloads from './ModelDownloads.vue';
import { ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Box, Download, Trash2 } from 'lucide-vue-next';
import { useCatalog } from '../stores/catalog';
import { modelUrl, fileUrl } from '../data/CatalogApi';
import { useModelPicker } from '../picker/useModelPicker';
const picker = useModelPicker();
const catalog = useCatalog(),
  name = ref(''),
  description = ref(''),
  tags = ref('');
watch(
  () => catalog.selected,
  (model) => {
    name.value = model?.metadata.name ?? '';
    description.value = model?.metadata.description ?? '';
    tags.value = model?.metadata.tags.join(', ') ?? '';
  },
  { immediate: true },
);
const bytes = (n: number) =>
  n > 1024 ** 2 ? (n / 1024 ** 2).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
async function remove() {
  try {
    await ElMessageBox.confirm(
      'Delete this model, its property database, and its cached conversions? Shared original files are retained until garbage collection.',
      'Delete model',
      { type: 'warning', confirmButtonText: 'Delete' },
    );
  } catch {
    return;
  }
  await catalog.remove();
}
</script>
<template>
  <div class="panel-scroll details-panel">
    <template v-if="catalog.selected"
      ><h1>{{ catalog.selected.metadata.name }}</h1>
      <p class="detail-provider">
        {{ modelFormatLabel(catalog.selected.format) ?? 'No model file' }} ·
        {{ catalog.selected.metadata.source.provider ?? 'Local import' }}
      </p>
      <div class="use-actions">
        <a
          v-if="catalog.selected.entrypoint"
          class="download-button"
          :href="modelUrl(catalog.selected.id) + '/bundle'"
          ><Download :size="14" />Download package</a
        >
      </div>
      <el-button
        v-if="catalog.selected.format === 'ifc'"
        :disabled="processing.busy"
        @click="processing.prepare(catalog.selected.id)"
        >Prepare IFC</el-button
      >
      <ModelProperties
        v-if="catalog.selected.format === 'ifc' && !picker.enabled"
        :key="catalog.selected.id + 'properties'"
        :model-id="catalog.selected.id"
      />
      <ModelDownloads
        v-if="catalog.selected.entrypoint"
        :key="catalog.selected.id"
        :model-id="catalog.selected.id"
      />
      <p v-if="picker.enabled && catalog.selected.metadata.description" class="detail-section">
        {{ catalog.selected.metadata.description }}
      </p>
      <form
        v-if="!picker.enabled"
        class="detail-section metadata-form"
        @submit.prevent="
          catalog.save({
            name,
            description,
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          })
        "
      >
        <label>Name<el-input v-model="name" required /></label
        ><label
          >Description<el-input
            v-model="description"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }" /></label
        ><label>Tags<el-input v-model="tags" placeholder="building, furniture, exterior" /></label
        ><el-button
          native-type="submit"
          :loading="catalog.saving"
          :disabled="!name.trim()"
          type="primary"
          >Save details</el-button
        >
      </form>
      <section
        v-if="catalog.selected.metadata.source.license || catalog.selected.metadata.source.url"
        class="detail-section"
      >
        <h2>Source and license</h2>
        <p>{{ catalog.selected.metadata.source.license }}</p>
        <p>{{ catalog.selected.metadata.source.attribution }}</p>
        <a
          v-if="catalog.selected.metadata.source.url"
          :href="catalog.selected.metadata.source.url"
          target="_blank"
          rel="noopener noreferrer"
          >Original source</a
        >
      </section>
      <section v-if="catalog.selected.warnings.length" class="detail-section">
        <h2>Import notices</h2>
        <p v-for="warning in catalog.selected.warnings" :key="warning">{{ warning }}</p>
      </section>
      <section class="detail-section">
        <h2>
          Package files<span>{{
            bytes(catalog.selected.files.reduce((n, f) => n + f.bytes, 0))
          }}</span>
        </h2>
        <ul class="file-list">
          <li v-for="file in catalog.selected.files" :key="file.path">
            <a :href="fileUrl(catalog.selected, file.path)" target="_blank" rel="noopener">{{
              file.path
            }}</a
            ><small
              >{{ bytes(file.bytes)
              }}{{ file.path === catalog.selected.entrypoint ? ' · Entry point' : '' }}</small
            >
          </li>
        </ul>
      </section>
      <section class="detail-section">
        <p class="model-id">{{ catalog.selected.id }}</p>
        <el-button
          v-if="!picker.enabled"
          class="delete-model"
          :disabled="catalog.saving"
          @click="remove"
          ><Trash2 :size="14" />Delete model</el-button
        >
      </section>
    </template>
    <div v-else class="empty-state">
      <Box :size="36" />
      <h2>Select a model</h2>
      <p>Inspect its files, edit its details, or copy a URL to use it in your own application.</p>
    </div>
  </div>
</template>
