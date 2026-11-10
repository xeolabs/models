<script setup lang="ts">
import ProviderAccountsDialog from './components/ProviderAccountsDialog.vue';
import { useProviderAccounts } from './stores/providerAccounts';
const accounts = useProviderAccounts();
import ProcessingDialog from './components/ProcessingDialog.vue';
import { useProcessing } from './stores/processing';
import { Loading } from '@element-plus/icons-vue';
const processing = useProcessing();
import { ElConfigProvider, ElIcon } from 'element-plus';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { DockviewVue, themeDark, themeLight, type DockviewReadyEvent } from 'dockview-vue';
import { Boxes, SlidersHorizontal, LayoutGrid, Info, Sun, Moon } from 'lucide-vue-next';
import { useTheme } from './theme';
import { useCatalog } from './stores/catalog';
import AcquisitionWorkspace from './components/AcquisitionWorkspace.vue';
import ImportDialog from './components/ImportDialog.vue';
import PreviewDialog from './preview/PreviewDialog.vue';
const importing = ref(false);
import LibraryFilters from './components/LibraryFilters.vue';
import ModelResults from './components/ModelResults.vue';
import ModelDetails from './components/ModelDetails.vue';

import { useModelPicker } from './picker/useModelPicker';
import PickerFooter from './picker/PickerFooter.vue';
import './picker/picker.css';
const catalog = useCatalog();
const picker = useModelPicker();
import { useAcquisition } from './stores/acquisition';
const remote = useAcquisition();
watch(
  () => [catalog.text, remote.text, remote.provider, remote.job?.id, remote.plan?.id],
  () => picker.saveBrowseState(),
);
const { theme, toggleTheme } = useTheme();
import { storeToRefs } from 'pinia';
const { workspace } = storeToRefs(picker);
watch(
  () => catalog.selected,
  () => {
    picker.highlight();
    picker.saveBrowseState();
  },
);
watch(workspace, () => picker.saveBrowseState());
function showLibrary() {
  workspace.value = 'library';
  void catalog.refresh();
}
const compact = ref(window.innerWidth < 1000);
let debounce: ReturnType<typeof setTimeout>;
function resize() {
  compact.value = window.innerWidth < 1000;
}

/**
 * Dockview owns resizing; the catalog store keeps selection when panels remount.
 */
function ready({ api }: DockviewReadyEvent) {
  api.addPanel({
    id: 'models',
    component: 'ModelResults',
    title: 'Models',
    minimumWidth: 320,
  });
  api.addPanel({
    id: 'library',
    component: 'LibraryFilters',
    title: 'Library',
    initialWidth: 230,
    minimumWidth: 190,
    position: { referencePanel: 'models', direction: 'left' },
  });
  api.addPanel({
    id: 'details',
    component: 'ModelDetails',
    title: 'Model details',
    initialWidth: 340,
    minimumWidth: 280,
    position: { referencePanel: 'models', direction: 'right' },
  });
}

// Wait for a pause in typing, and always restart a changed search on its first page.
watch(
  () => [catalog.text, [...catalog.selectedTags], catalog.provider, catalog.format, catalog.sort],
  () => {
    clearTimeout(debounce);
    if (catalog.page !== 1) catalog.page = 1;
    debounce = setTimeout(() => void catalog.search(), 180);
  },
);
watch(
  () => catalog.page,
  () => {
    clearTimeout(debounce);
    void catalog.search();
  },
);
onMounted(() => {
  processing.start();
  void picker.start();
  window.addEventListener('resize', resize);
  void catalog.refresh();
});
onUnmounted(() => {
  window.removeEventListener('resize', resize);
  clearTimeout(debounce);
  processing.stop();
  catalog.dispose();
  picker.dispose();
});
</script>

<template>
  <ElConfigProvider size="small">
    <div class="app-shell" :class="{ 'picker-shell': picker.enabled }">
      <section v-if="picker.enabled" class="picker-context" aria-label="Studio picker context">
        <div>
          <strong>Choose a model for Studio</strong
          ><span>Adding to the current workspace · {{ picker.targetOrigin }}</span>
        </div>
        <span>{{ picker.connected ? 'Studio connected' : 'Waiting for Studio…' }}</span>
      </section>
      <header class="app-header">
        <span class="brand-mark" aria-hidden="true"><Boxes :size="20" /></span>
        <strong>Models</strong>
        <span class="header-divider" />
        <span class="catalog-name" :title="catalog.summary?.name">{{
          catalog.summary?.name || 'Opening library…'
        }}</span>
        <span class="header-spacer" /><el-button
          class="import-files-button"
          @click="importing = true"
          >Import files</el-button
        >
        <nav class="workspace-tabs" aria-label="Workspace">
          <button :aria-pressed="workspace === 'library'" @click="showLibrary">Library</button>
          <button :aria-pressed="workspace === 'acquisition'" @click="workspace = 'acquisition'">
            Find models
          </button>
        </nav>
        <el-button @click="accounts.open = true">Provider accounts</el-button>
        <el-button class="processing-button" @click="processing.open = true">
          <el-icon v-if="processing.active" class="is-loading"><Loading /></el-icon>
          Processing<span v-if="processing.active || processing.queued">
            · {{ processing.active + processing.queued }}</span
          >
        </el-button>
        <el-button
          v-if="!picker.enabled"
          class="theme-toggle"
          :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggleTheme"
          ><Sun v-if="theme === 'dark'" :size="16" aria-hidden="true" />
          <Moon v-else :size="16" aria-hidden="true" />
        </el-button>
      </header>

      <nav
        v-if="compact && workspace === 'library'"
        class="mobile-navigation"
        aria-label="Catalog panels"
      >
        <button
          :aria-pressed="catalog.mobilePanel === 'models'"
          @click="catalog.mobilePanel = 'models'"
        >
          <LayoutGrid :size="16" />Models
        </button>
        <button
          :aria-pressed="catalog.mobilePanel === 'filters'"
          @click="catalog.mobilePanel = 'filters'"
        >
          <SlidersHorizontal :size="16" />Filters<span v-if="catalog.filtered" class="filter-dot" />
        </button>
        <button
          :aria-pressed="catalog.mobilePanel === 'details'"
          @click="catalog.mobilePanel = 'details'"
        >
          <Info :size="16" />Details
        </button>
      </nav>
      <main class="workspace" aria-label="Model catalog">
        <AcquisitionWorkspace v-if="workspace === 'acquisition'" />
        <template v-else-if="compact">
          <LibraryFilters v-if="catalog.mobilePanel === 'filters'" />
          <ModelResults v-else-if="catalog.mobilePanel === 'models'" />
          <ModelDetails v-else />
        </template>
        <DockviewVue
          v-else
          class="studio-dock"
          :theme="theme === 'dark' ? themeDark : themeLight"
          :disable-dnd="true"
          :disable-floating-groups="true"
          default-tab-component="PanelTitle"
          @ready="ready"
        >
        </DockviewVue>
      </main>
      <PickerFooter v-if="picker.enabled" />
      <footer v-else class="app-status">
        <span>{{ catalog.summary?.modelCount ?? '—' }} models in library</span
        ><span>{{ 'Connected to models server' }}</span>
      </footer>
    </div>
    <ImportDialog v-model="importing" @imported="showLibrary" />
    <PreviewDialog />
    <ProviderAccountsDialog />
    <ProcessingDialog />
  </ElConfigProvider>
</template>
