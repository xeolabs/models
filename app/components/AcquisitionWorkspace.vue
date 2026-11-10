<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useAcquisition } from '../stores/acquisition';
import RemoteSearch from './RemoteSearch.vue';
import AcquisitionPlanReview from './AcquisitionPlanReview.vue';
import AcquisitionJobProgress from './AcquisitionJobProgress.vue';
const remote = useAcquisition();
onMounted(() => remote.start());
onUnmounted(() => remote.dispose());
</script>
<template>
  <div class="acquisition-workspace">
    <div v-if="remote.error" class="acquisition-error" role="alert">{{ remote.error }}</div>
    <RemoteSearch />
    <aside class="acquisition-review-panel" aria-label="Plans and jobs">
      <div class="acquisition-history">
        <label
          >Saved plans<el-select
            :model-value="
              remote.pendingReview?.kind === 'plan'
                ? remote.pendingReview.id
                : remote.job
                  ? ''
                  : (remote.plan?.id ?? '')
            "
            placeholder="Choose a plan"
            aria-label="Saved plans"
            @change="remote.choosePlan"
            ><el-option
              v-for="plan in remote.plans"
              :key="plan.id"
              :value="plan.id"
              :label="`${plan.createdAt.slice(0, 16).replace('T', ' ')} · ${plan.items.length} models`" /></el-select></label
        ><label
          >Jobs<el-select
            :model-value="
              remote.pendingReview?.kind === 'job'
                ? remote.pendingReview.id
                : (remote.job?.id ?? '')
            "
            placeholder="Choose a job"
            aria-label="Acquisition jobs"
            @change="remote.chooseJob"
            ><el-option
              v-for="job in remote.jobs"
              :key="job.id"
              :value="job.id"
              :label="`${job.createdAt.slice(0, 16).replace('T', ' ')} · ${job.status}`" /></el-select></label
        ><el-button @click="remote.refresh()">Refresh</el-button>
      </div>
      <div class="acquisition-review">
        <p v-if="remote.pendingReview" class="review-loading" role="status">
          {{ remote.reviewMessage }}
        </p>
        <div
          class="review-content"
          :class="{ 'review-pending': remote.pendingReview }"
          :aria-busy="!!remote.pendingReview"
          :inert="remote.pendingReview ? true : undefined"
        >
          <AcquisitionJobProgress v-if="remote.job" :key="remote.job.id" />
          <AcquisitionPlanReview v-else-if="remote.plan" :key="remote.plan.id" />
          <div v-else class="empty-state">
            <h2>Review before acquiring</h2>
            <p>
              Select models or plan a search. The saved plan lists the exact downloads, license
              information and compatibility notices.
            </p>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>
