import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { request, readResponse } from '../data/http';
import type { ProcessingOverview, ProcessingSettings } from '../../src/processing/types';

/**
 * One poll serves the header and queue dialog. Settings edits stay local until saved.
 */
export const useProcessing = defineStore('processing', () => {
  const overview = ref<ProcessingOverview>(),
    open = ref(false),
    error = ref(''),
    busy = ref(false);
  let timer: ReturnType<typeof setInterval> | undefined, controller: AbortController | undefined;
  const active = computed(
    () => (overview.value?.counts.running ?? 0) + (overview.value?.counts.cancelling ?? 0),
  );
  const queued = computed(() => overview.value?.counts.queued ?? 0);
  async function refresh() {
    if (controller) return;
    const current = new AbortController();
    controller = current;
    try {
      overview.value = await request<ProcessingOverview>('/api/processing', current.signal);
    } catch (cause) {
      if (!current.signal.aborted)
        error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (controller === current) controller = undefined;
    }
  }
  function start() {
    if (timer) return;
    void refresh();
    timer = setInterval(() => void refresh(), 2000);
  }
  function stop() {
    clearInterval(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }
  async function action(url: string, method = 'POST', body?: unknown) {
    busy.value = true;
    error.value = '';
    try {
      await readResponse(
        await fetch('/api/processing/' + url, {
          method,
          headers: { 'X-Models-Action': 'explicit', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      await refresh();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      busy.value = false;
    }
  }
  async function configure(settings: Partial<ProcessingSettings>) {
    await action('settings', 'PATCH', settings);
  }
  async function prepare(id: string) {
    open.value = true;
    await action('models/' + encodeURIComponent(id) + '/prepare');
  }
  return {
    overview,
    open,
    error,
    busy,
    active,
    queued,
    start,
    stop,
    refresh,
    configure,
    prepare,
    cancel: (id: string) => action('jobs/' + encodeURIComponent(id) + '/cancel'),
    retry: (id: string) => action('jobs/' + encodeURIComponent(id) + '/retry'),
  };
});
