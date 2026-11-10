<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { Box, Check, Tags, SlidersHorizontal } from 'lucide-vue-next';
import { useCatalog } from '../stores/catalog';
const catalog = useCatalog();
</script>
<template>
  <div class="panel-scroll filters-panel">
    <button class="all-models" :aria-pressed="!catalog.filtered" @click="catalog.reset">
      <Box :size="16" />All models<span class="count">{{ catalog.summary?.modelCount ?? 0 }}</span>
    </button>
    <section class="filter-section">
      <h2><SlidersHorizontal :size="14" />Filter models</h2>
      <label for="format-filter">File format</label
      ><el-select id="format-filter" v-model="catalog.format" clearable placeholder="All formats"
        ><el-option
          v-for="format in catalog.formats.filter(
            (f) => !catalog.compatibleFormats.length || catalog.compatibleFormats.includes(f),
          )"
          :key="format"
          :value="format"
          :label="modelFormatLabel(format)"
      /></el-select>
      <label for="provider-filter">Source</label
      ><el-select
        id="provider-filter"
        v-model="catalog.provider"
        clearable
        placeholder="All sources"
        ><el-option
          v-for="provider in catalog.summary?.providers ?? []"
          :key="provider"
          :value="provider"
          :label="provider"
      /></el-select>
    </section>
    <section class="filter-section">
      <h2><Tags :size="14" />Tags</h2>
      <p v-if="!catalog.tags.length" class="help-text">
        Add tags in model details to organize your library.
      </p>
      <div class="tag-list">
        <button
          v-for="tag in catalog.tags"
          :key="tag.name"
          class="tag-filter"
          :aria-pressed="catalog.selectedTags.includes(tag.name)"
          @click="catalog.toggleTag(tag.name)"
        >
          <span class="tag-check"
            ><Check v-if="catalog.selectedTags.includes(tag.name)" :size="12" /></span
          >{{ tag.name }}<span class="count">{{ tag.count }}</span>
        </button>
      </div>
    </section>
    <el-button v-if="catalog.filtered" class="clear-filters" @click="catalog.reset"
      >Clear filters</el-button
    >
  </div>
</template>
