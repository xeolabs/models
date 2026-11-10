<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { ElInputNumber } from 'element-plus';
import { useAcquisition } from '../stores/acquisition';
const remote = useAcquisition();
</script>
<template>
  <details class="remote-filter-panel" open>
    <summary>Filter and sort results</summary>
    <div class="remote-filter-controls">
      <label
        >Format<el-select v-model="remote.format" aria-label="Filter model format"
          ><el-option label="Any (prefer glTF)" value="auto" /><el-option
            v-for="format in ['gltf', 'glb', 'fbx', 'blend', 'ifc']"
            :key="format"
            :value="format"
            :label="modelFormatLabel(format)" /></el-select
      ></label>
      <label
        >Size / variant<el-select
          v-model="remote.filterResolution"
          clearable
          placeholder="All sizes"
          aria-label="Filter texture size"
          ><el-option
            v-for="size in remote.resultResolutions"
            :key="size"
            :value="size"
            :label="size.toUpperCase()" /></el-select
      ></label>
      <label
        >Maximum download (MiB)<ElInputNumber
          v-model="remote.maxDownloadMiB"
          :min="0.1"
          :precision="1"
          :step="10"
          :controls="false"
          placeholder="No limit"
          aria-label="Maximum package download MiB"
      /></label>
      <label
        >Maximum polygons<ElInputNumber
          v-model="remote.maxPolygons"
          :min="0"
          :precision="0"
          :controls="false"
          placeholder="No limit"
          aria-label="Maximum polygons"
      /></label>
      <label
        >Tag<el-select
          v-model="remote.filterTag"
          clearable
          filterable
          placeholder="All tags"
          aria-label="Filter tag"
          ><el-option
            v-for="tag in remote.resultTags"
            :key="tag"
            :value="tag"
            :label="tag" /></el-select
      ></label>
      <label
        >Sort<el-select v-model="remote.resultSort" aria-label="Sort provider results"
          ><el-option label="Name" value="name" /><el-option
            label="Smallest download"
            value="size" /><el-option label="Largest download" value="size-desc" /><el-option
            label="Fewest polygons"
            value="polygons" /></el-select
      ></label>
    </div>
    <p class="section-note">
      Download sizes include the model and supporting files. Poly Haven sizes refer to textures;
      Smithsonian variants refer to model quality. Unknown values are excluded when a limit is set.
    </p>
    <div class="result-filter-actions">
      <span
        >{{ remote.visibleResults.length }} of {{ remote.results.length }} results<span
          v-if="remote.statisticsLoading"
        >
          · Checking {{ remote.statisticsPending }} sizes…</span
        ></span
      ><el-button
        :disabled="
          !remote.visibleResults.length ||
          remote.searching ||
          (remote.filtersActive && remote.statisticsLoading)
        "
        v-if="remote.canPlan"
        @click="remote.selectVisible"
        >Select matching</el-button
      ><el-button v-if="remote.filtersActive" @click="remote.resetFilters">Clear filters</el-button>
    </div>
    <p v-if="remote.selectionNotice" role="status" class="section-note">
      {{ remote.selectionNotice }}
    </p>
    <el-button v-if="Object.keys(remote.statisticsErrors).length" @click="remote.refreshStatistics"
      >Retry size lookup</el-button
    >
  </details>
</template>
