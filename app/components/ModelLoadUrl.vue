<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElInput, ElMessage, type InputInstance } from 'element-plus';
import { Copy } from 'lucide-vue-next';
import type { ModelRepresentationFormat } from '../../src/conversion/ModelFormats';

const props = defineProps<{ url: string; format: ModelRepresentationFormat }>();
const field = ref<InputInstance>();
const label = computed(() => (props.format === 'datamodel' ? 'DataModel URL' : 'Model URL'));
async function copy() {
  try {
    await navigator.clipboard.writeText(props.url);
    ElMessage.success(label.value + ' copied');
  } catch {
    // Clipboard access may be unavailable when Models is served over plain HTTP.
    field.value?.focus();
    field.value?.select();
    ElMessage.info('Select and copy the URL from the field.');
  }
}
</script>
<template>
  <div class="model-load-url">
    <label
      >{{ label }}
      <div class="url-controls">
        <ElInput
          ref="field"
          :model-value="url"
          readonly
          type="textarea"
          :rows="2"
          resize="none"
          :aria-label="label"
          @focus="field?.select()"
        />
        <el-button
          :aria-label="format === 'datamodel' ? 'Copy DataModel URL' : 'Copy model URL'"
          :title="'Copy ' + label"
          @click="copy"
          ><Copy :size="14"
        /></el-button>
      </div>
    </label>
    <p v-if="format === 'xgfstream'">
      Stream manifest. The loader fetches its chunks from this server.
    </p>
    <p v-else-if="format !== 'datamodel'">
      Direct model file. Related files load from the same server.
    </p>
  </div>
</template>
<style scoped>
.model-load-url {
  margin: 14px 0;
  min-width: 0;
}
.model-load-url label {
  display: grid;
  gap: 6px;
}
.url-controls {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  min-width: 0;
}
.url-controls .el-textarea {
  min-width: 0;
  flex: 1;
}
.url-controls .el-button {
  flex: none;
  margin: 0;
}
.model-load-url p {
  font-size: 12px;
  line-height: 1.5;
  margin: 6px 0;
  color: var(--el-text-color-secondary);
}
</style>
