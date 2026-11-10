import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { request, change, modelUrl } from '../data/CatalogApi';
import type { ModelRecord, Metadata } from '../../src/domain/types.js';

/**
 * Selection stays in the store when Dockview or the narrow layout remounts a panel.
 * A newer request always wins over a slower, older response.
 */
export const useCatalog = defineStore('catalog', () => {
  const summary = ref<{ name: string; modelCount: number; providers: string[] } | null>(null),
    tags = ref<{ name: string; count: number }[]>([]),
    formats = ref<string[]>([]);
  const text = ref(''),
    provider = ref(''),
    format = ref(''),
    compatibleFormats = ref<string[]>([]),
    selectedTags = ref<string[]>([]),
    sort = ref('name'),
    page = ref(1),
    total = ref(0),
    items = ref<ModelRecord[]>([]);
  const selected = ref<ModelRecord | null>(null),
    loading = ref(false),
    saving = ref(false),
    selecting = ref(false),
    error = ref(''),
    mobilePanel = ref('models');
  const filtered = computed(
    () => !!(text.value || provider.value || format.value || selectedTags.value.length),
  );
  let controller: AbortController | undefined,
    selectionVersion = 0;
  async function search() {
    controller?.abort();
    const current = (controller = new AbortController());
    loading.value = true;
    error.value = '';
    try {
      const q = new URLSearchParams({
        q: text.value,
        provider: provider.value,
        format: format.value,
        sort: sort.value,
        offset: String((page.value - 1) * 48),
        limit: '48',
      });
      compatibleFormats.value.forEach((f) => q.append('formats', f));
      selectedTags.value.forEach((t) => q.append('tag', t));
      const result = await request<{ items: ModelRecord[]; total: number }>(
        '/api/models?' + q,
        current.signal,
      );
      if (current.signal.aborted) return;
      items.value = result.items;
      total.value = result.total;
    } catch (e) {
      if (!current.signal.aborted) error.value = (e as Error).message;
    } finally {
      if (!current.signal.aborted) loading.value = false;
    }
  }
  async function refresh() {
    try {
      [summary.value, tags.value, formats.value] = await Promise.all([
        request<NonNullable<typeof summary.value>>('/api/summary'),
        request<typeof tags.value>('/api/tags'),
        request<string[]>('/api/formats'),
      ]);
      await search();
      if (selected.value) await select(selected.value.id, false);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  async function select(id: string, show = true) {
    const version = ++selectionVersion;
    selecting.value = true;
    try {
      const result = await request<ModelRecord>(modelUrl(id));
      if (version !== selectionVersion) return;
      selected.value = result;
      if (show) mobilePanel.value = 'details';
    } catch (e) {
      if (version === selectionVersion) {
        selected.value = null;
        error.value = (e as Error).message;
      }
    } finally {
      if (version === selectionVersion) selecting.value = false;
    }
  }
  async function save(metadata: Partial<Metadata>) {
    if (!selected.value) return;
    const id = selected.value.id;
    saving.value = true;
    error.value = '';
    try {
      await change(modelUrl(id), 'PATCH', metadata);
      await refresh();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      saving.value = false;
    }
  }
  async function remove() {
    if (!selected.value) return;
    saving.value = true;
    try {
      await change(modelUrl(selected.value.id), 'DELETE');
      selected.value = null;
      await refresh();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      saving.value = false;
    }
  }
  function toggleTag(tag: string) {
    selectedTags.value = selectedTags.value.includes(tag)
      ? selectedTags.value.filter((t) => t !== tag)
      : [...selectedTags.value, tag];
  }
  function reset() {
    text.value = '';
    provider.value = '';
    format.value = '';
    selectedTags.value = [];
  }
  function dispose() {
    controller?.abort();
    selectionVersion++;
  }
  return {
    summary,
    tags,
    formats,
    text,
    provider,
    format,
    selectedTags,
    sort,
    page,
    total,
    items,
    selected,
    loading,
    saving,
    selecting,
    compatibleFormats,
    error,
    mobilePanel,
    filtered,
    refresh,
    search,
    select,
    save,
    remove,
    toggleTag,
    reset,
    dispose,
  };
});
