// @vitest-environment jsdom
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useModelPicker } from '../app/picker/useModelPicker';
import { useCatalog } from '../app/stores/catalog';
import { pickerMessage } from '../src/browser/ModelPickerProtocol.js';

const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const modelId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const origin = 'https://studio.example';
const receiver = { postMessage: vi.fn(), focus: vi.fn() } as unknown as Window;
let picker: ReturnType<typeof useModelPicker>;
function receive(type: Parameters<typeof pickerMessage>[1], source = receiver, sender = origin) {
  window.dispatchEvent(
    new MessageEvent('message', { origin: sender, source, data: pickerMessage(requestId, type) }),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  setActivePinia(createPinia());
  sessionStorage.clear();
  history.replaceState(
    null,
    '',
    '/picker?request=' +
      requestId +
      '&origin=' +
      encodeURIComponent(origin) +
      '&formats=gltf,glb&theme=light',
  );
  Object.defineProperty(window, 'opener', { value: receiver, configurable: true });
  vi.mocked(receiver.postMessage).mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: url.endsWith('/api/picker') ? { allowedOrigins: [origin] } : { name: 'Library' },
      }),
    })),
  );
  picker = useModelPicker();
});
afterEach(() => {
  picker.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

test('only the opening Studio can connect; selection requires an explicit user action and acknowledgement', async () => {
  await picker.start();
  expect(document.documentElement.dataset.theme).toBe('light');
  receive('connected', receiver, 'https://evil.example');
  expect(picker.connected).toBe(false);
  receive('connected', {} as Window);
  expect(picker.connected).toBe(false);
  receive('connected');
  expect(picker.connected).toBe(true);
  const catalog = useCatalog();
  catalog.selected = {
    id: modelId,
    metadata: { name: 'Triangle', description: '', tags: [], source: {} },
    entrypoint: 'scene.gltf',
    format: 'gltf',
    files: [],
    warnings: [],
    createdAt: '',
    updatedAt: '2026-11-09T12:00:00.000Z',
  };
  expect(picker.canSelect).toBe(true);
  expect(vi.mocked(receiver.postMessage).mock.calls.some((call) => call[0].type === 'select')).toBe(
    false,
  );
  catalog.selecting = true;
  expect(picker.canSelect).toBe(false);
  catalog.selecting = false;
  picker.select();
  expect(picker.pending).toBe(true);
  expect(receiver.postMessage).toHaveBeenLastCalledWith(
    pickerMessage(requestId, 'select', { modelId, updatedAt: catalog.selected.updatedAt }),
    origin,
  );
  receive('accepted');
  expect(picker.accepted).toBe(true);
  expect(picker.pending).toBe(false);
});

test('unsupported selections and a missing connection cannot be submitted', async () => {
  await picker.start();
  expect(picker.canSelect).toBe(false);
  receive('connected');
  const catalog = useCatalog();
  catalog.selected = {
    id: modelId,
    metadata: { name: 'Revit', description: '', tags: [], source: {} },
    entrypoint: 'scene.rvt',
    format: 'rvt',
    files: [],
    warnings: [],
    createdAt: '',
    updatedAt: '2026-11-09T12:00:00.000Z',
  };
  picker.select();
  expect(picker.pending).toBe(false);
  receive('ended');
  expect(picker.connected).toBe(false);
  expect(picker.error).toContain('ended');
});
