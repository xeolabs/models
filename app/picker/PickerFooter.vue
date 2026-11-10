<script setup lang="ts">
import { modelFormatLabel } from '../modelFormatLabel';
import { useModelPicker } from './useModelPicker';
const picker = useModelPicker();
const size = (bytes: number) =>
  bytes >= 1024 ** 2 ? (bytes / 1024 ** 2).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB';
</script>
<template>
  <footer class="picker-footer" aria-label="Studio model selection">
    <div class="picker-selection" aria-live="polite">
      <strong v-if="picker.accepted">Selection sent to Studio</strong>
      <strong v-else>{{
        picker.selecting
          ? 'Selecting model…'
          : picker.selected?.metadata.name || picker.selectionPrompt
      }}</strong>
      <span v-if="picker.selected"
        >{{ modelFormatLabel(picker.selected.format) }} ·
        {{ picker.selected.metadata.source.resolution || 'Original files' }} ·
        {{ size(picker.bytes) }}</span
      >
      <span v-if="picker.selected && !picker.compatible"
        >This format cannot be loaded by this Studio.</span
      >
      <span v-if="picker.error" role="alert" class="picker-error">{{ picker.error }}</span>
    </div>
    <el-button v-if="picker.accepted" type="primary" @click="picker.returnToStudio"
      >Return to Studio</el-button
    >
    <template v-else>
      <el-button :disabled="picker.pending" @click="picker.cancel">Cancel</el-button>
      <el-button
        type="primary"
        :disabled="!picker.canSelect"
        :loading="picker.pending"
        @click="picker.select"
        >Load in Studio</el-button
      >
    </template>
  </footer>
</template>
