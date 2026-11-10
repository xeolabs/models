import { defineStore } from 'pinia';
import { ref } from 'vue';
import { SketchfabAccountApi, type SketchfabAccountStatus } from '../data/SketchfabAccountApi';
import { useAcquisition } from './acquisition';

/**
 * Holds public account status. The password field belongs to the dialog and is
 * cleared after submission; tokens are never saved in browser storage or this store.
 */
export const useProviderAccounts = defineStore('providerAccounts', () => {
  const open = ref(false),
    busy = ref(false),
    error = ref('');
  const status = ref<SketchfabAccountStatus>();
  const api = new SketchfabAccountApi();
  let revision = 0;
  async function refresh() {
    if (busy.value) return;
    const current = ++revision;
    try {
      const result = await api.status();
      if (current !== revision) return;
      status.value = result;
      error.value = '';
    } catch (cause) {
      if (current === revision)
        error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  async function change(work: () => Promise<SketchfabAccountStatus>) {
    if (busy.value) return;
    revision++;
    busy.value = true;
    error.value = '';
    try {
      status.value = await work();
      await useAcquisition().refreshProviders();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy.value = false;
    }
  }
  return {
    open,
    busy,
    error,
    status,
    refresh,
    connect: (method: 'api-token' | 'oauth', token: string) =>
      change(() => api.connect(method, token)),
    verify: () => change(() => api.verify()),
    disconnect: () => change(() => api.disconnect()),
  };
});
