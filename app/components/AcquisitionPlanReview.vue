<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { ref } from 'vue';
import { ElDialog } from 'element-plus';
import { useAcquisition } from '../stores/acquisition';
const remote = useAcquisition(),
  confirm = ref(false);
const bytes = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MiB`;
async function execute() {
  confirm.value = false;
  await remote.execute();
}
</script>
<template>
  <section v-if="remote.plan" class="plan-review" aria-label="Review acquisition plan">
    <h2>Review plan</h2>
    <p class="section-note">
      {{ remote.plan.summary.selectedModels }} model packages ·
      {{ [...new Set(remote.plan.items.map((item) => item.resolution))].join(', ').toUpperCase() }}
      · {{ bytes(remote.plan.summary.knownBytes) }} estimated download
    </p>
    <p v-if="remote.plan.summary.unknownSizeFiles" class="remote-warning">
      {{ remote.plan.summary.unknownSizeFiles }} files have unknown sizes.
    </p>
    <p class="section-note">
      {{
        remote.plan.criteria.skipExisting
          ? 'Models already in your library will be skipped.'
          : 'These models will be imported as new copies.'
      }}
    </p>
    <details class="plan-identity">
      <summary>Technical details</summary>
      <p>
        Automatic download limit: {{ bytes(remote.plan.criteria.maxTotalBytes) }}, including
        retries.
      </p>
      <p>{{ remote.plan.id }}</p>
      <p>Fingerprint: {{ remote.plan.fingerprint }}</p>
      <p>Valid until {{ remote.plan.expiresAt }}. The server revalidates files before execution.</p>
    </details>
    <p v-for="(warning, index) in remote.plan.warnings" :key="index" class="remote-warning">
      {{ warning.message }}
    </p>
    <div class="plan-items">
      <article v-for="item in remote.plan.items" :key="item.id" class="plan-item">
        <strong>{{ item.modelName }}</strong>
        <p>
          {{ item.provider }} · {{ item.resolution.toUpperCase() }} ·
          {{ modelFormatLabel(item.format) }} · {{ item.expectedLicense.id }}
          <span v-if="item.existingModelId">· Already in library</span>
        </p>
        <details>
          <summary>
            {{ item.files.length }} selected {{ item.files.length === 1 ? 'file' : 'files' }}
          </summary>
          <ul>
            <li v-for="file in item.files" :key="file.filename">
              {{ file.filename }} ·
              {{ file.sizeBytes === undefined ? 'size unknown' : bytes(file.sizeBytes)
              }}<br /><small
                >{{ file.role }} ·
                {{
                  file.checksum
                    ? `${file.checksum.algorithm}: ${file.checksum.value}`
                    : 'No provider checksum'
                }}</small
              >
            </li>
          </ul>
        </details>
        <details v-if="item.warnings.length">
          <summary>
            {{ item.warnings.length }} compatibility
            {{ item.warnings.length === 1 ? 'notice' : 'notices' }}
          </summary>
          <ul>
            <li v-for="(warning, index) in item.warnings" :key="index">{{ warning.message }}</li>
          </ul>
        </details>
      </article>
    </div>
    <el-button
      type="primary"
      :disabled="!remote.plan.items.length"
      :loading="remote.busy"
      @click="confirm = true"
      >Acquire models…</el-button
    >
    <ElDialog
      v-model="confirm"
      title="Acquire these models?"
      width="min(460px, calc(100vw - 32px))"
    >
      <p>
        The server will download and import the {{ remote.plan.items.length }} model packages in
        this saved plan. Estimated download: {{ bytes(remote.plan.summary.knownBytes) }}.
      </p>
      <p class="section-note">
        Jobs continue when you leave this page. You can cancel a running job or resume an
        interrupted one.
      </p>
      <template #footer
        ><el-button @click="confirm = false">Back</el-button
        ><el-button type="primary" @click="execute">Start acquisition</el-button></template
      >
    </ElDialog>
  </section>
</template>
