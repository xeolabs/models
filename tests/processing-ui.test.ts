// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { ElSwitch } from 'element-plus';
import ProcessingDialog from '../app/components/ProcessingDialog.vue';
import { useProcessing } from '../app/stores/processing';

test('processing presents real queue status, settings and cancellation without resetting edits on polling', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useProcessing();
  store.overview = {
    settings: {
      automaticIFC: false,
      paused: false,
      memoryLimitMiB: 2048,
      reserveMemoryMiB: 1024,
      cpuCores: 1,
      timeoutMinutes: 60,
    },
    workerLimit: 1,
    resourceMonitoring: 'linux',
    freeMemoryBytes: 8 * 1024 ** 3,
    counts: {
      queued: 1,
      running: 1,
      cancelling: 0,
      completed: 0,
      failed: 1,
      cancelled: 0,
      interrupted: 0,
    },
    jobs: [
      {
        id: 'running',
        modelId: 'one',
        modelName: 'Office',
        format: 'xgf',
        kind: 'prepare-ifc',
        source: 'automatic',
        status: 'running',
        phase: 'Reading IFC',
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: '2026-01-01T00:00:00Z',
        heartbeatAt: '2026-01-01T00:01:05Z',
        memoryBytes: 1024 ** 3,
        cpuPercent: 48,
      },
      {
        id: 'failed',
        modelId: 'two',
        modelName: 'Hospital',
        format: 'xgf',
        kind: 'prepare-ifc',
        source: 'requested',
        status: 'failed',
        phase: 'Failed',
        createdAt: '2026-01-01T00:00:00Z',
        error: 'Worker reached its memory limit.',
      },
    ],
  };
  const cancel = vi.spyOn(store, 'cancel').mockResolvedValue(),
    retry = vi.spyOn(store, 'retry').mockResolvedValue(),
    configure = vi.spyOn(store, 'configure').mockResolvedValue();
  const wrapper = mount(ProcessingDialog, {
    attachTo: document.body,
    global: {
      plugins: [pinia],
    },
  });
  try {
    store.open = true;
    await flushPromises();
    expect(document.body.textContent).toContain('1 running · 1 queued');
    expect(document.body.textContent).toContain('Reading IFC');
    expect(document.body.textContent).toContain('1024 MiB');
    expect(document.body.textContent).toContain('48% CPU');
    expect(document.body.textContent).toContain('1m 5s');
    expect(document.querySelector('.is-loading')).not.toBeNull();
    const buttons = () => [...document.querySelectorAll('button')];
    buttons()
      .find((button) => button.textContent === 'Cancel')!
      .click();
    expect(cancel).toHaveBeenCalledWith('running');
    buttons()
      .find((button) => button.textContent === 'Retry')!
      .click();
    expect(retry).toHaveBeenCalledWith('failed');
    buttons()
      .find((button) => button.textContent === 'Pause queue')!
      .click();
    expect(configure).toHaveBeenCalledWith({ paused: true });
    wrapper.findComponent(ElSwitch).vm.$emit('update:modelValue', true);
    store.overview = { ...store.overview, freeMemoryBytes: 7 * 1024 ** 3 };
    await flushPromises();
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ automaticIFC: true, cpuCores: 1 }),
    );
  } finally {
    wrapper.unmount();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  }
});
