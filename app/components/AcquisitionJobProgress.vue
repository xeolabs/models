<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { computed, ref } from 'vue';
import { ElDialog, ElProgress } from 'element-plus';
import { useAcquisition } from '../stores/acquisition';
import { useAcquiredModelSelection } from '../picker/useAcquiredModelSelection';
import { useModelPicker } from '../picker/useModelPicker';
const picker = useModelPicker();
useAcquiredModelSelection();
const remote = useAcquisition(),
  confirm = ref(false);
const percentage = computed(() =>
  remote.job?.totalItems
    ? Math.round(
        (100 * (remote.job.completedItems + remote.job.failedItems + remote.job.skippedItems)) /
          remote.job.totalItems,
      )
    : 0,
);
async function resume() {
  confirm.value = false;
  await remote.resume();
}
</script>
<template>
  <section v-if="remote.job" class="job-progress" aria-label="Acquisition job">
    <h2>Acquisition job</h2>
    <p class="job-status" role="status">{{ remote.job.status.replaceAll('_', ' ') }}</p>
    <ElProgress :percentage="percentage" />
    <p class="section-note">
      {{ remote.job.completedItems }} imported · {{ remote.job.skippedItems }} skipped ·
      {{ remote.job.failedItems }} failed<br />{{
        (remote.job.downloadedBytes / 1024 ** 2).toFixed(1)
      }}
      MiB transferred, including retries
    </p>
    <div class="job-actions">
      <el-button
        v-if="remote.job.status === 'running'"
        :loading="remote.busy"
        @click="remote.cancel()"
        >Cancel job</el-button
      ><el-button
        v-else-if="
          ['failed', 'interrupted', 'cancelled', 'completed_with_errors'].includes(
            remote.job.status,
          )
        "
        type="primary"
        :loading="remote.busy"
        @click="confirm = true"
        >Resume unfinished items…</el-button
      ><el-button @click="remote.chooseJob(remote.job!.id)">Refresh status</el-button>
    </div>
    <p v-if="picker.enabled && picker.acquiredModels.length" class="section-note">
      Choose the model and resolution to load, then click Load in Studio below.
    </p>
    <article
      v-for="item in remote.job.items"
      :key="item.id"
      class="job-item"
      :class="{ 'job-item-selected': picker.enabled && picker.selected?.id === item.modelId }"
    >
      <strong>{{ item.modelName }} · {{ item.resolution?.toUpperCase() }}</strong>
      <span>{{ item.status }} · Attempt {{ item.attempts }}</span>
      <p v-if="item.modelId">Model {{ item.modelId }}</p>
      <template v-if="picker.enabled && item.modelId">
        <label v-if="picker.canChooseAcquired(item)" class="acquired-model-choice">
          <input
            type="radio"
            name="studio-acquired-model"
            :value="item.modelId"
            :checked="picker.selected?.id === item.modelId"
            :disabled="picker.pending"
            :aria-label="'Select ' + item.modelName + ' ' + item.resolution + ' for Studio'"
            @change="picker.selectAcquired(item.modelId)"
          />
          <span>{{
            picker.selectingAcquiredId === item.modelId
              ? 'Selecting model…'
              : 'Use this model in Studio'
          }}</span>
        </label>
        <p v-else-if="!picker.supportsFormat(item.format)" class="remote-warning">
          Studio cannot load {{ modelFormatLabel(item.format) }}. Acquire a supported format such as
          glTF instead.
        </p>
        <el-button
          :disabled="picker.pending || picker.selecting"
          @click="picker.chooseAcquired(item.modelId)"
          >View in library</el-button
        >
      </template>
      <p v-if="item.errorMessage" class="remote-warning">{{ item.errorMessage }}</p>
      <details v-if="item.warnings.length">
        <summary>Import notices</summary>
        <ul>
          <li v-for="(warning, index) in item.warnings" :key="index">{{ warning.message }}</li>
        </ul>
      </details>
    </article>
    <ElDialog v-model="confirm" title="Resume this job?" width="min(460px, calc(100vw - 32px))"
      ><p>The original plan and transfer limit still apply. Completed imports will be kept.</p>
      <template #footer
        ><el-button @click="confirm = false">Back</el-button
        ><el-button type="primary" @click="resume">Resume acquisition</el-button></template
      ></ElDialog
    >
  </section>
</template>
