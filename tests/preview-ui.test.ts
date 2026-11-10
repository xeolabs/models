// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ElButton, ElInput, ElSelect, ElOption, ElPagination } from 'element-plus';
import PreviewDialog from '../app/preview/PreviewDialog.vue';
import ModelResults from '../app/components/ModelResults.vue';
import { initialPreviewState } from '../app/preview/types';
import { useCatalog } from '../app/stores/catalog';

const preview = vi.hoisted(() => ({
  state: {} as ReturnType<typeof initialPreviewState>,
  controller: {
    warm: vi.fn().mockResolvedValue({}),
    park: vi.fn(),
    mount: vi.fn(),
    close: vi.fn(),
    fit: vi.fn(),
    cancel: vi.fn(),
    setMode: vi.fn(),
    setEffect: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../app/preview/store', () => ({ usePreview: () => preview }));
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

test('preview warms quietly and presents cancellation and rendering controls in the modal', async () => {
  vi.useFakeTimers();
  preview.state = reactive(initialPreviewState());
  const wrapper = mount(PreviewDialog, {
    attachTo: document.body,
    global: { components: { ElButton } },
  });
  try {
    expect((document.querySelector('.el-overlay') as HTMLElement).style.display).toBe('none');
    await vi.advanceTimersByTimeAsync(900);
    expect(preview.controller.warm).toHaveBeenCalledOnce();
    preview.state.open = true;
    preview.state.phase = 'loading';
    preview.state.progress = { message: 'Downloading model…', current: 20, total: 100 };
    await flushPromises();
    expect(document.body.textContent).toContain('Downloading model…');
    expect(document.querySelector('progress')?.value).toBe(20);
    const buttons = () => Array.from(document.querySelectorAll('button'));
    buttons()
      .find((button) => button.textContent?.includes('Cancel loading'))!
      .click();
    expect(preview.controller.cancel).toHaveBeenCalledOnce();
    expect(buttons().find((button) => button.textContent === 'Path trace')?.disabled).toBe(true);
    preview.state.phase = 'ready';
    await flushPromises();
    expect(
      buttons()
        .find((button) => button.textContent === 'Engineering')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    buttons()
      .find((button) => button.textContent === 'Path trace')!
      .click();
    expect(preview.controller.setMode).toHaveBeenCalledWith('pathTracing');
    buttons()
      .find((button) => button.textContent?.includes('Fit model'))!
      .click();
    expect(preview.controller.fit).toHaveBeenCalled();
    wrapper.findComponent({ name: 'ElDialog' }).vm.$emit('update:modelValue', false);
    expect(preview.controller.close).toHaveBeenCalledOnce();
  } finally {
    wrapper.unmount();
  }
});

test('the library preview button opens the viewer without changing catalog selection', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const catalog = useCatalog();
  catalog.items = [
    {
      id: 'one',
      format: 'obj',
      entrypoint: 'model.obj',
      files: [],
      metadata: { name: 'Office', description: '', tags: [], source: {} },
      warnings: [],
      createdAt: '',
      updatedAt: '',
    },
  ];
  const select = vi.spyOn(catalog, 'select').mockResolvedValue();
  const wrapper = mount(ModelResults, {
    global: {
      plugins: [pinia],
      components: { ElButton, ElInput, ElSelect, ElOption, ElPagination },
    },
  });
  try {
    expect(wrapper.find('button button').exists()).toBe(false);
    await wrapper.get('[aria-label="Preview Office in 3D"]').trigger('click');
    expect(preview.controller.open).toHaveBeenCalledWith(catalog.items[0]);
    expect(select).not.toHaveBeenCalled();
    await wrapper.get('.model-select').trigger('click');
    expect(select).toHaveBeenCalledWith('one');
  } finally {
    wrapper.unmount();
  }
});
