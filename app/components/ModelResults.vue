<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { Box, Search, ScanEye, RefreshCw } from 'lucide-vue-next';
import IFCThumbnail from './IFCThumbnail.vue';
import ThumbnailImage from './ThumbnailImage.vue';
import { useCatalog } from '../stores/catalog';
import { usePreview } from '../preview/store';
const catalog = useCatalog();
const viewer = usePreview();
const preview = (model: (typeof catalog.items)[number]) =>
  ['polyhaven', 'smithsonian', 'sketchfab'].includes(model.metadata.source.provider ?? '') &&
  model.metadata.source.remoteId
    ? '/api/acquisition/models/' +
      model.metadata.source.provider +
      '/' +
      encodeURIComponent(model.metadata.source.remoteId) +
      '/preview'
    : undefined;
</script>
<template>
  <div class="results-panel">
    <div class="search-toolbar">
      <el-input
        v-model="catalog.text"
        clearable
        placeholder="Search models, tags or descriptions"
        aria-label="Search library"
        ><template #prefix><Search :size="16" /></template></el-input
      ><el-select v-model="catalog.sort" class="sort-select" aria-label="Sort models"
        ><el-option value="name" label="Name" /><el-option value="createdAt" label="Date added"
      /></el-select>
    </div>
    <div class="result-summary">
      <span>{{ catalog.total }} models{{ catalog.loading ? ' · Loading…' : '' }}</span>
      <el-button
        text
        :loading="catalog.loading"
        aria-label="Refresh library"
        title="Refresh library"
        @click="catalog.refresh()"
      >
        <RefreshCw v-if="!catalog.loading" :size="14" />Refresh
      </el-button>
    </div>
    <div v-if="catalog.error" role="alert" class="acquisition-error">{{ catalog.error }}</div>
    <div class="results-scroll">
      <div
        v-if="catalog.items.length"
        class="model-grid"
        :class="{ refreshing: catalog.loading }"
        :aria-busy="catalog.loading"
      >
        <article
          v-for="model in catalog.items"
          :key="model.id"
          class="model-card"
          :data-selected="catalog.selected?.id === model.id"
        >
          <button
            class="model-select"
            :aria-pressed="catalog.selected?.id === model.id"
            @click="catalog.select(model.id)"
          >
            <IFCThumbnail
              v-if="model.format === 'ifc'"
              :model-id="model.id"
              :name="model.metadata.name"
            />
            <ThumbnailImage
              v-else
              class="model-preview"
              :src="preview(model)"
              :alt="model.metadata.name"
            >
              <div class="preview-fallback">
                <Box :size="42" /><span>{{
                  modelFormatLabel(model.format) ?? 'Empty record'
                }}</span>
              </div>
            </ThumbnailImage>
            <div class="card-content">
              <strong>{{ model.metadata.name }}</strong
              ><span class="card-provider">{{
                model.metadata.source.provider ?? 'Local import'
              }}</span>
              <div class="card-footer">
                <span>{{ modelFormatLabel(model.format) ?? 'No file' }}</span
                ><span>{{ model.files.length }} files</span>
              </div>
            </div>
          </button>
          <div class="model-card-actions">
            <el-button
              :disabled="!model.entrypoint"
              :aria-label="'Preview ' + model.metadata.name + ' in 3D'"
              @click="viewer.controller.open(model)"
              ><ScanEye :size="15" />3D preview</el-button
            >
          </div>
        </article>
      </div>
      <div v-else class="empty-state">
        <Box :size="40" />
        <h2>
          {{
            catalog.loading
              ? 'Loading models…'
              : catalog.filtered
                ? 'No matching models'
                : 'Your model library is empty'
          }}
        </h2>
        <p>Import local model files, or use Find models to discover models from Poly Haven.</p>
      </div>
    </div>
    <div v-if="catalog.total > 48" class="pagination">
      <el-pagination
        v-model:current-page="catalog.page"
        :page-size="48"
        :total="catalog.total"
        layout="prev, pager, next"
      />
    </div>
  </div>
</template>
