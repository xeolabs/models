<script setup lang="ts">
import ModelStatistics from './ModelStatistics.vue';
import RemoteResultFilters from './RemoteResultFilters.vue';
import ProviderThumbnail from './ProviderThumbnail.vue';
import { ElInputNumber, ElCheckbox } from 'element-plus';
import { Search, ExternalLink } from 'lucide-vue-next';
import { useProviderAccounts } from '../stores/providerAccounts';
const accounts = useProviderAccounts();
import { useAcquisition } from '../stores/acquisition';
const remote = useAcquisition();
</script>
<template>
  <section class="remote-search-panel" aria-label="Find provider models">
    <form class="remote-search-form" @submit.prevent="remote.search()">
      <el-input
        v-model="remote.text"
        placeholder="Chair, tree, building…"
        aria-label="Search providers"
        :prefix-icon="Search"
      />
      <el-select v-model="remote.provider" aria-label="Model provider">
        <el-option label="All providers" value="all" />
        <el-option
          v-for="provider in remote.providers"
          :key="provider.id"
          :label="provider.name"
          :value="provider.id"
        />
      </el-select>
      <el-button native-type="submit" type="primary" :loading="remote.searching">Search</el-button>
    </form>
    <el-button
      v-if="remote.provider === 'sketchfab'"
      class="provider-authentication-button"
      @click="accounts.open = true"
      >Sketchfab authentication</el-button
    >
    <p
      v-for="failure in remote.providerErrors"
      :key="failure.provider"
      class="remote-warning"
      role="alert"
    >
      {{ remote.providerName(failure.provider) }}: {{ failure.message }}
    </p>
    <RemoteResultFilters v-if="remote.searched" />
    <div class="remote-results" :aria-busy="remote.searching">
      <p v-if="!remote.searched" class="empty-state">
        Search the providers to find models for your library.
      </p>
      <p v-else-if="!remote.results.length && !remote.searching" class="empty-state">
        No models found. Try fewer keywords.
      </p>
      <p v-if="remote.results.length && !remote.visibleResults.length" class="empty-state">
        {{
          remote.statisticsLoading
            ? 'Checking sizes for these filters…'
            : 'No models match these filters.'
        }}
      </p>
      <article
        v-for="model in remote.visibleResults"
        :key="remote.key(model)"
        class="remote-model"
        :class="{ selected: remote.selection.includes(remote.key(model)) }"
      >
        <ProviderThumbnail :model="model" />
        <div class="remote-model-content">
          <ElCheckbox
            v-if="remote.canAcquire(model.provider)"
            :model-value="remote.selection.includes(remote.key(model))"
            :aria-label="`Select ${model.name}`"
            @change="remote.toggle(model)"
            >{{ model.name }}</ElCheckbox
          >
          <strong v-if="!remote.canAcquire(model.provider)">{{ model.name }}</strong>
          <div class="remote-model-info">
            <el-tag>{{ remote.providerName(model.provider) }}</el-tag
            ><span>{{ model.license.name }}</span
            ><a :href="model.sourceUrl" target="_blank" rel="noopener noreferrer"
              >{{ remote.canAcquire(model.provider) ? 'Source' : 'Download on website' }}
              <ExternalLink :size="12"
            /></a>
          </div>
          <p
            v-if="!remote.canAcquire(model.provider) && remote.provider === 'all'"
            class="section-note"
          >
            {{ remote.info(model.provider)?.notice }}
          </p>
          <ModelStatistics
            :model="model"
            :downloads="remote.downloadStatistics[remote.key(model)]"
            :error="remote.statisticsErrors[remote.key(model)]"
            :format="remote.format"
            :resolution="remote.filterResolution"
            :max-bytes="remote.maxDownloadMiB ? remote.maxDownloadMiB * 1024 ** 2 : undefined"
          />
          <p v-if="model.description">{{ model.description }}</p>
          <div class="remote-tags">
            <span v-for="tag in model.tags.slice(0, 5)" :key="tag">{{ tag }}</span>
          </div>
        </div>
      </article>
    </div>
    <form v-if="remote.canPlan" class="plan-options" @submit.prevent="remote.createPlan()">
      <details class="plan-settings">
        <summary>Import options · up to {{ remote.maxModels }} models</summary>
        <div class="plan-settings-fields">
          <p v-if="remote.filterResolution" class="section-note">
            Import variant: {{ remote.filterResolution.toUpperCase() }} (from result filters)
          </p>
          <label v-else class="resolution-options">
            Sizes / variants
            <el-select v-model="remote.resolutionMode" aria-label="Resolution selection">
              <el-option label="All available sizes" value="all" />
              <el-option
                label="Choose sizes…"
                value="selected"
                :disabled="!remote.selection.length"
              />
            </el-select>
            <el-select
              v-if="remote.resolutionMode === 'selected'"
              v-model="remote.selectedResolutions"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :loading="remote.resolutionsLoading"
              placeholder="Select provider sizes"
              aria-label="Download resolutions"
            >
              <el-option
                v-for="size in remote.resolutionChoices"
                :key="size.resolution"
                :value="size.resolution"
                :label="`${size.resolution.toUpperCase()} (${size.count}/${remote.selection.length} models)`"
              />
            </el-select>
            <span v-if="remote.resolutionsLoading" role="status">Checking available sizes…</span>
            <span
              v-else-if="remote.selection.length && remote.resolutionChoices.length"
              class="section-note"
            >
              Available:
              {{ remote.resolutionChoices.map((s) => s.resolution.toUpperCase()).join(', ') }}
            </span>
            <span v-else-if="!remote.selection.length" class="section-note"
              >Select models to choose specific sizes.</span
            >
          </label>
          <label
            >Model limit<ElInputNumber
              v-model="remote.maxModels"
              :min="1"
              :max="500"
              aria-label="Model limit"
          /></label>
        </div>
      </details>
      <el-button
        class="create-plan-button"
        type="primary"
        native-type="submit"
        :loading="remote.busy"
        :disabled="
          !remote.canPlan ||
          (remote.filtersActive && remote.statisticsLoading) ||
          (!remote.selection.length && !remote.text.trim() && !remote.filtersActive) ||
          (remote.filtersActive && !remote.visibleResults.length) ||
          (!remote.filterResolution && !remote.resolutionsValid)
        "
        >{{
          remote.selection.length
            ? `Plan ${remote.selection.length} selected`
            : remote.filtersActive
              ? 'Plan matching results'
              : 'Plan this search'
        }}</el-button
      >
      <div v-if="remote.resolutionErrors.length" class="resolution-errors" role="alert">
        <p v-for="message in remote.resolutionErrors" :key="message" class="remote-warning">
          {{ message }}
        </p>
        <el-button text @click="remote.refreshResolutions()">Retry size lookup</el-button>
      </div>
      <p class="section-note">
        Review the exact files, variants and total size in the saved plan before downloading.
      </p>
    </form>
    <p v-else class="section-note">{{ remote.providerNotice }}</p>
  </section>
</template>
