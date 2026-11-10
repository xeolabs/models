<script setup lang="ts">
import { reactive, watch } from 'vue';
import {
  ElDialog,
  ElButton,
  ElIcon,
  ElSwitch,
  ElInputNumber,
  ElSelect,
  ElOption,
} from 'element-plus';
import { Loading } from '@element-plus/icons-vue';
import { useProcessing } from '../stores/processing';
import { modelFormatLabel } from '../modelFormatLabel';
import type { ProcessingJob, ProcessingSettings } from '../../src/processing/types';
const processing = useProcessing();
const settings = reactive<ProcessingSettings>({
  propertySetMode: 'embedded',
  automaticIFC: false,
  paused: false,
  memoryLimitMiB: 2048,
  reserveMemoryMiB: 1024,
  cpuCores: 1,
  timeoutMinutes: 60,
});
watch([() => processing.open, () => !!processing.overview], ([open]) => {
  if (open && processing.overview) Object.assign(settings, processing.overview.settings);
});
const memory = (bytes?: number) => (bytes == null ? '—' : Math.round(bytes / 1024 ** 2) + ' MiB');
const elapsed = (job: ProcessingJob) => {
  if (!job.startedAt) return '—';
  const end =
    job.completedAt ??
    processing.overview?.jobs.find((item) => item.id === job.id)?.heartbeatAt ??
    new Date().toISOString();
  const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(job.startedAt)) / 1000));
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
};
const title = (job: ProcessingJob) =>
  job.kind === 'prepare-ifc'
    ? 'IFC → XGF + DataModel'
    : job.kind === 'export-properties'
      ? 'Complete DataModel download'
      : job.kind === 'thumbnail'
        ? 'Thumbnail'
        : job.kind === 'inspect'
          ? 'Inspect formats'
          : modelFormatLabel(job.format);
</script>
<template>
  <el-dialog
    v-model="processing.open"
    title="Processing"
    width="min(1080px, 95vw)"
    class="processing-dialog"
    :close-on-click-modal="false"
  >
    <div class="processing-summary">
      <span
        ><el-icon v-if="processing.active" class="is-loading"><Loading /></el-icon
        >{{ processing.active }} running · {{ processing.queued }} queued</span
      >
      <span>{{ memory(processing.overview?.freeMemoryBytes) }} available</span>
      <el-button
        :disabled="processing.busy"
        @click="processing.configure({ paused: !processing.overview?.settings.paused })"
        >{{ processing.overview?.settings.paused ? 'Resume queue' : 'Pause queue' }}</el-button
      >
    </div>
    <p v-if="processing.overview?.waitingReason" role="status">
      {{ processing.overview.waitingReason }}
    </p>
    <p v-if="processing.error" role="alert" class="processing-error">{{ processing.error }}</p>
    <details class="processing-settings">
      <summary>Processing settings</summary>
      <form
        @submit.prevent="
          processing.configure({
            ...settings,
            paused: processing.overview?.settings.paused ?? false,
          })
        "
      >
        <label class="processing-auto"
          ><el-switch
            v-model="settings.automaticIFC"
            aria-label="Automatically prepare new IFC models"
          />Automatically prepare new IFC models</label
        >
        <label class="processing-auto"
          >Properties for new IFC imports
          <el-select v-model="settings.propertySetMode" aria-label="Default IFC property storage">
            <el-option value="embedded" label="Include in DataModel JSON" />
            <el-option value="external" label="Store on server" />
          </el-select>
        </label>
        <div class="processing-fields">
          <label
            >Worker memory (MiB)<el-input-number
              v-model="settings.memoryLimitMiB"
              :min="256"
              :max="65536"
              :step="256"
          /></label>
          <label
            >Keep free (MiB)<el-input-number
              v-model="settings.reserveMemoryMiB"
              :min="256"
              :max="65536"
              :step="256"
          /></label>
          <label>CPU cores<el-input-number v-model="settings.cpuCores" :min="1" :max="4" /></label>
          <label
            >Time limit (minutes)<el-input-number
              v-model="settings.timeoutMinutes"
              :min="1"
              :max="1440"
          /></label>
        </div>
        <p>One low-priority worker. New settings apply to the next job.</p>
        <p v-if="processing.overview?.resourceMonitoring === 'portable'">
          CPU affinity and total-memory monitoring require Linux. This server uses a heap limit and
          low priority.
        </p>
        <el-button native-type="submit" type="primary" :loading="processing.busy"
          >Save settings</el-button
        >
      </form>
    </details>
    <div class="processing-jobs">
      <p v-if="!processing.overview?.jobs.length">No conversion jobs yet.</p>
      <article v-for="job in processing.overview?.jobs" :key="job.id" class="processing-job">
        <div class="processing-job-heading">
          <strong>{{ job.modelName }}</strong
          ><span>{{ title(job) }}</span>
        </div>
        <div class="processing-job-status">
          <span
            ><el-icon
              v-if="job.status === 'running' || job.status === 'cancelling'"
              class="is-loading"
              ><Loading /></el-icon
            >{{ job.phase }}</span
          >
          <span>{{ elapsed(job) }}</span>
          <span v-if="job.memoryBytes">{{ memory(job.memoryBytes) }}</span>
          <span v-if="job.cpuPercent != null">{{ job.cpuPercent }}% CPU</span>
          <el-button
            v-if="['queued', 'running', 'cancelling'].includes(job.status)"
            :disabled="processing.busy || job.status === 'cancelling'"
            @click="processing.cancel(job.id)"
            >{{ job.status === 'cancelling' ? 'Cancelling…' : 'Cancel' }}</el-button
          >
          <el-button
            v-if="['failed', 'cancelled', 'interrupted'].includes(job.status)"
            :disabled="processing.busy"
            @click="processing.retry(job.id)"
            >Retry</el-button
          >
        </div>
        <p v-if="job.error" class="processing-error">{{ job.error }}</p>
      </article>
    </div>
  </el-dialog>
</template>
<style scoped>
.processing-summary,
.processing-job-heading,
.processing-job-status {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.processing-summary {
  margin-bottom: 18px;
}
.processing-summary .el-button {
  margin-left: auto;
}
.processing-summary .el-icon,
.processing-job-status .el-icon {
  margin-right: 6px;
}
.processing-settings {
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 18px;
}
.processing-settings summary {
  cursor: pointer;
}
.processing-settings form {
  margin-top: 14px;
}
.processing-auto {
  display: flex;
  align-items: center;
  gap: 10px;
}
.processing-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 16px;
  margin: 16px 0;
}
.processing-fields label {
  display: grid;
  gap: 8px;
}
.processing-jobs {
  max-height: 48vh;
  overflow: auto;
  scrollbar-gutter: stable;
}
.processing-job {
  padding: 14px 2px;
  border-top: 1px solid var(--el-border-color);
}
.processing-job-heading {
  justify-content: space-between;
  margin-bottom: 10px;
}
.processing-job-heading strong {
  overflow-wrap: anywhere;
}
.processing-job-status {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.processing-job-status .el-button {
  margin-left: auto;
}
.processing-error {
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}
</style>
