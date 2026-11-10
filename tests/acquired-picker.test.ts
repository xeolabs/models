// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { useModelPicker } from '../app/picker/useModelPicker';
import { useCatalog } from '../app/stores/catalog';
import { useAcquisition } from '../app/stores/acquisition';
import AcquisitionJobProgress from '../app/components/AcquisitionJobProgress.vue';
import PickerFooter from '../app/picker/PickerFooter.vue';
import { pickerMessage } from '../src/browser/ModelPickerProtocol.js';
import type { ModelRecord } from '../src/domain/types.js';
import type { JobDetails } from '../app/data/AcquisitionApi';

const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ids = ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc'];
const origin = 'https://studio.example';
const receiver = { postMessage: vi.fn(), focus: vi.fn() } as unknown as Window;
let picker: ReturnType<typeof useModelPicker>;
let remote: ReturnType<typeof useAcquisition>;
let panel: VueWrapper | undefined;
const models: ModelRecord[] = ids.map((id, index) => ({
  id,
  metadata: {
    name: 'Chair (' + (index ? '4K' : '1K') + ')',
    description: '',
    tags: [],
    source: { resolution: index ? '4k' : '1k' },
  },
  format: 'gltf',
  entrypoint: 'chair.gltf',
  files: [],
  warnings: [],
  createdAt: '2026-11-09T12:00:00.000Z',
  updatedAt: '2026-11-09T12:00:00.000Z',
}));
function job(count = 2): JobDetails {
  return {
    id: 'job',
    planId: 'plan',
    status: 'completed',
    createdAt: '',
    downloadedBytes: 50,
    totalItems: count,
    completedItems: count,
    failedItems: 0,
    skippedItems: 0,
    items: models.slice(0, count).map((model, index) => ({
      id: 'item-' + index,
      jobId: 'job',
      planItemId: 'plan-' + index,
      modelName: 'Chair',
      provider: 'polyhaven',
      remoteId: 'chair',
      resolution: index ? '4k' : '1k',
      format: 'gltf',
      status: 'completed',
      modelId: model.id,
      attempts: 1,
      downloadedBytes: 25,
      warnings: [],
    })),
  };
}
const Button = defineComponent({
  props: ['disabled', 'loading'],
  emits: ['click'],
  template: `<button :disabled="disabled" @click="$emit('click')"><slot/></button>`,
});
const Host = defineComponent({
  components: { AcquisitionJobProgress, PickerFooter },
  template: '<AcquisitionJobProgress/><PickerFooter/>',
});
function render() {
  panel = mount(Host, {
    global: { components: { ElButton: Button }, stubs: { ElDialog: true, ElProgress: true } },
  });
  return panel;
}
function loadButton() {
  return panel!.findAll('button').find((button) => button.text() === 'Load in Studio')!;
}
async function settle() {
  await flushPromises();
  await nextTick();
}

beforeEach(async () => {
  setActivePinia(createPinia());
  sessionStorage.clear();
  history.replaceState(
    null,
    '',
    '/picker?request=' + requestId + '&origin=' + encodeURIComponent(origin) + '&formats=gltf,glb',
  );
  Object.defineProperty(window, 'opener', { value: receiver, configurable: true });
  vi.mocked(receiver.postMessage).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const model = models.find((model) => url.endsWith('/api/models/' + model.id));
      return {
        ok: true,
        json: async () => ({
          ok: true,
          data:
            model ??
            (url.endsWith('/api/picker') ? { allowedOrigins: [origin] } : { name: 'Library' }),
        }),
      };
    }),
  );
  picker = useModelPicker();
  remote = useAcquisition();
  await picker.start();
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: receiver,
      data: pickerMessage(requestId, 'connected'),
    }),
  );
  picker.workspace = 'acquisition';
});
afterEach(() => {
  panel?.unmount();
  panel = undefined;
  picker.dispose();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

test('a job becoming completed enables Load in Studio without leaving acquisition or loading automatically', async () => {
  remote.job = job(1);
  remote.job.status = 'running';
  remote.job.items[0].status = 'downloading';
  remote.job.items[0].modelId = undefined;
  render();
  await settle();
  expect(loadButton().attributes('disabled')).toBeDefined();
  remote.job = job(1);
  await settle();
  expect(picker.workspace).toBe('acquisition');
  expect(picker.selected?.id).toBe(ids[0]);
  expect(loadButton().attributes('disabled')).toBeUndefined();
  expect(panel!.get('input[type="radio"]').element).toHaveProperty('checked', true);
  expect(vi.mocked(receiver.postMessage).mock.calls.some((call) => call[0].type === 'select')).toBe(
    false,
  );
  await loadButton().trigger('click');
  expect(receiver.postMessage).toHaveBeenLastCalledWith(
    pickerMessage(requestId, 'select', { modelId: ids[0], updatedAt: models[0].updatedAt }),
    origin,
  );
});

test('resolution choice survives polling and the selected resolution is submitted', async () => {
  remote.job = job();
  render();
  await settle();
  await panel!.findAll('input[type="radio"]')[1].setValue();
  await settle();
  expect(picker.selected?.id).toBe(ids[1]);
  remote.job = job();
  await settle();
  expect(picker.selected?.id).toBe(ids[1]);
  expect(loadButton().attributes('disabled')).toBeUndefined();
  await loadButton().trigger('click');
  expect(receiver.postMessage).toHaveBeenLastCalledWith(
    pickerMessage(requestId, 'select', { modelId: ids[1], updatedAt: models[1].updatedAt }),
    origin,
  );
});

test('reused acquisitions can be selected and unsupported results explain the disabled action', async () => {
  remote.job = job();
  remote.job.items[0].format = 'blend';
  remote.job.items[1].status = 'skipped';
  render();
  await settle();
  expect(picker.selected?.id).toBe(ids[1]);
  expect(panel!.text()).toContain('Studio cannot load BLEND');
  expect(panel!.findAll('input[type="radio"]')).toHaveLength(1);
  remote.job = { ...job(1), id: 'unsupported', items: [{ ...job(1).items[0], format: 'blend' }] };
  await settle();
  expect(picker.selected).toBeNull();
  expect(loadButton().attributes('disabled')).toBeDefined();
  expect(panel!.text()).toContain('no completed model in a format Studio can load');
});

test('failed model reads surface an error, do not repeat on polling, and can be retried', async () => {
  remote.job = job(1);
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, init) =>
    String(url).endsWith('/api/models/' + ids[0])
      ? ({
          ok: false,
          json: async () => ({ ok: false, error: { message: 'Catalog unavailable' } }),
        } as Response)
      : original(url, init),
  );
  render();
  await settle();
  expect(loadButton().attributes('disabled')).toBeDefined();
  expect(panel!.text()).toContain('Catalog unavailable');
  const calls = vi.mocked(fetch).mock.calls.length;
  remote.job = job(1);
  await settle();
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  vi.mocked(fetch).mockImplementation(original);
  await panel!.get('input[type="radio"]').setValue();
  await settle();
  expect(loadButton().attributes('disabled')).toBeUndefined();
});

test('pending job reviews cannot submit a previous library model', async () => {
  useCatalog().selected = models[0];
  remote.job = job(1);
  remote.pendingReview = { kind: 'job', id: 'another-job' };
  render();
  await settle();
  expect(picker.selected).toBeNull();
  expect(loadButton().attributes('disabled')).toBeDefined();
  remote.pendingReview = null;
  await settle();
  expect(loadButton().attributes('disabled')).toBeUndefined();
});
