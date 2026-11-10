<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDialog } from 'element-plus';
import { change } from '../data/CatalogApi';
import { readResponse } from '../data/http';
const propertySetMode = ref<'' | 'embedded' | 'external'>('');
const open = defineModel<boolean>({ required: true }),
  emit = defineEmits<{ imported: [] }>();
const files = ref<File[]>([]),
  entrypoint = ref(''),
  name = ref(''),
  tags = ref(''),
  busy = ref(false),
  error = ref(''),
  progress = ref('');
const relative = (f: File) => f.webkitRelativePath || f.name;
const entries = computed(() =>
  files.value.filter((f) =>
    /\.(gltf|glb|ifc|obj|stl|ply|las|laz|e57|fbx|blend|step|stp|dxf|dae|json|xkt|xgf|rvt|nwd|zip)$/i.test(
      f.name,
    ),
  ),
);
function choose(event: Event) {
  files.value = Array.from((event.target as HTMLInputElement).files ?? []);
  entrypoint.value = entries.value.length === 1 ? relative(entries.value[0]) : '';
  error.value = '';
}
watch(open, (value) => {
  if (value && !busy.value) {
    files.value = [];
    entrypoint.value = '';
    name.value = '';
    propertySetMode.value = '';
    tags.value = '';
    error.value = '';
  }
});
async function upload() {
  if (!entrypoint.value) return;
  busy.value = true;
  error.value = '';
  let id: string | undefined;
  try {
    id = (await change<{ id: string }>('/api/imports', 'POST')).id;
    for (let i = 0; i < files.value.length; i++) {
      const f = files.value[i];
      progress.value = `Uploading ${i + 1} of ${files.value.length}: ${f.name}`;
      await readResponse(
        await fetch('/api/imports/' + id + '/files?path=' + encodeURIComponent(relative(f)), {
          method: 'PUT',
          headers: { 'X-Models-Action': 'explicit' },
          body: f,
        }),
      );
    }
    progress.value = 'Checking model and importing files…';
    await change('/api/imports/' + id + '/commit', 'POST', {
      entrypoint: entrypoint.value,
      ...(propertySetMode.value && /\.ifc$/i.test(entrypoint.value)
        ? { propertySetMode: propertySetMode.value }
        : {}),
      name: name.value.trim() || undefined,
      tags: tags.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    id = undefined;
    open.value = false;
    emit('imported');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    if (id) await change('/api/imports/' + id, 'DELETE').catch(() => {});
    busy.value = false;
    progress.value = '';
  }
}
</script>
<template>
  <ElDialog
    v-model="open"
    title="Import a model"
    width="min(560px, 94vw)"
    :close-on-click-modal="!busy"
    :show-close="!busy"
    :close-on-press-escape="!busy"
  >
    <form class="import-form" @submit.prevent="upload">
      <p>
        Choose a model and its supporting files, or a folder containing the complete package. ZIP
        imports use a Models export bundle.
      </p>
      <label>Choose files<input type="file" multiple :disabled="busy" @change="choose" /></label
      ><label
        >Or choose a folder<input
          type="file"
          webkitdirectory
          multiple
          :disabled="busy"
          @change="choose"
      /></label>
      <label
        >Model entry point<el-select
          v-model="entrypoint"
          :disabled="busy"
          placeholder="Select the model file"
          ><el-option
            v-for="f in entries"
            :key="relative(f)"
            :value="relative(f)"
            :label="relative(f)" /></el-select
      ></label>
      <label v-if="/\.ifc$/i.test(entrypoint)"
        >Properties<el-select
          v-model="propertySetMode"
          :disabled="busy"
          aria-label="IFC property storage"
        >
          <el-option value="" label="Library default" />
          <el-option value="embedded" label="Include in DataModel JSON" />
          <el-option value="external" label="Store on server" /> </el-select
      ></label>
      <label>Name (optional)<el-input v-model="name" :disabled="busy" /></label
      ><label
        >Tags (optional)<el-input
          v-model="tags"
          :disabled="busy"
          placeholder="building, architecture"
      /></label>
      <p class="help-text">
        Up to 64 files, 256 MiB per file and 512 MiB per upload. External resources must be
        included.
      </p>
      <p v-if="progress" role="status">{{ progress }}</p>
      <p v-if="error" role="alert" class="acquisition-error">{{ error }}</p>
      <div class="use-actions">
        <el-button native-type="submit" type="primary" :loading="busy" :disabled="!entrypoint"
          >Import model</el-button
        ><el-button :disabled="busy" @click="open = false">Cancel</el-button>
      </div>
    </form></ElDialog
  >
</template>
