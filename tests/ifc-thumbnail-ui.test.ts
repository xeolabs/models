// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import IFCThumbnail from '../app/components/IFCThumbnail.vue';
import { useProcessing } from '../app/stores/processing';
import { request } from '../app/data/http';
vi.mock('../app/data/http', () => ({ request: vi.fn() }));
test('IFC cards pick up cached thumbnails after queue completion and reuse the standard loading spinner', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const processing = useProcessing();
  vi.mocked(request)
    .mockResolvedValueOnce({ ready: false })
    .mockResolvedValue({ ready: true, url: '/api/models/one/thumbnail?revision=ready' });
  const wrapper = mount(IFCThumbnail, {
    props: { modelId: 'one', name: 'Office IFC' },
    global: { plugins: [pinia] },
  });
  try {
    await flushPromises();
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toContain('IFC');
    processing.overview = {
      settings: {
        automaticIFC: false,
        paused: false,
        memoryLimitMiB: 2048,
        reserveMemoryMiB: 1024,
        cpuCores: 1,
        timeoutMinutes: 60,
      },
      jobs: [],
      counts: {
        completed: 1,
        queued: 0,
        running: 0,
        cancelling: 0,
        failed: 0,
        cancelled: 0,
        interrupted: 0,
      },
      freeMemoryBytes: 0,
      workerLimit: 1,
      resourceMonitoring: 'linux',
    };
    await flushPromises();
    expect(wrapper.find('img').attributes('src')).toContain('/thumbnail');
    expect(wrapper.find('.is-loading').exists()).toBe(true);
    await wrapper.find('img').trigger('load');
    expect(wrapper.find('.is-loading').exists()).toBe(false);
    expect(vi.mocked(request).mock.calls.every(([url]) => url.endsWith('/thumbnail/status'))).toBe(
      true,
    );
  } finally {
    wrapper.unmount();
    vi.clearAllMocks();
  }
});
