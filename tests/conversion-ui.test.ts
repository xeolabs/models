// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ElButton, ElSelect, ElOption, ElInput } from 'element-plus';
import ModelDownloads from '../app/components/ModelDownloads.vue';
import { change, request } from '../app/data/CatalogApi';
vi.mock('../app/data/CatalogApi', () => ({
  request: vi.fn(),
  change: vi.fn(),
  modelUrl: (id: string) => '/api/models/' + id,
}));
const choices = (id: string) => ({
  modelId: id,
  warnings: [],
  formats: [
    {
      format: 'glb' as const,
      entrypoint: 'model.glb',
      source: 'converted',
      cached: false,
      warnings: ['Some metadata is not preserved.'],
    },
  ],
});
const setup = () =>
  mount(ModelDownloads, {
    props: { modelId: 'first' },
    global: { components: { ElButton, ElSelect, ElOption, ElInput } },
  });
afterEach(() => {
  vi.clearAllMocks();
});

test.each(['glb', 'xgfstream'] as const)(
  '%s loads without converting, and an explicit download becomes cached',
  async (format) => {
    vi.mocked(request).mockResolvedValue({
      modelId: 'first',
      warnings: [],
      formats: [
        {
          format,
          entrypoint: format === 'xgfstream' ? 'index.runtime.json' : 'model.glb',
          source: 'converted',
          cached: false,
          warnings: ['Some metadata is not preserved.'],
        },
      ],
    });
    vi.mocked(change).mockResolvedValue({
      files: [{ bytes: 100 }],
      warnings: ['Some metadata is not preserved.'],
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const wrapper = setup();
    try {
      expect(wrapper.find('.el-icon.is-loading').exists()).toBe(true);
      await flushPromises();
      expect(change).not.toHaveBeenCalled();
      if (format === 'xgfstream') expect(wrapper.text()).toContain('XGF Stream');
      expect(wrapper.text()).toContain('Some metadata is not preserved.');
      await wrapper.get('button.format-download').trigger('click');
      await flushPromises();
      expect(change).toHaveBeenCalledWith('/api/models/first/conversions/' + format, 'POST');
      expect(click).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('Cached download');
    } finally {
      wrapper.unmount();
      click.mockRestore();
    }
  },
);

test('switching models ignores a late format response and late download completion', async () => {
  let complete!: (value: unknown) => void;
  vi.mocked(request)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(choices('second'));
  const wrapper = setup();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await wrapper.setProps({ modelId: 'second' });
    await flushPromises();
    complete({ modelId: 'first', formats: [], message: 'Old response' });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Old response');
    vi.mocked(change).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await wrapper.get('button.format-download').trigger('click');
    expect(wrapper.text()).toContain('Preparing download');
    await wrapper.setProps({ modelId: 'third' });
    await flushPromises();
    complete({ files: [{ bytes: 100 }], warnings: [] });
    await flushPromises();
    expect(click).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain('Cached download');
  } finally {
    wrapper.unmount();
    click.mockRestore();
  }
});

test('a conversion failure keeps the format selected and allows retry', async () => {
  vi.mocked(request).mockResolvedValue(choices('first'));
  vi.mocked(change).mockRejectedValue(new Error('Unsupported texture encoding'));
  const wrapper = setup();
  try {
    await flushPromises();
    await wrapper.get('button.format-download').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('original package is still available');
    expect(wrapper.get('button.format-download').attributes('disabled')).toBeUndefined();
  } finally {
    wrapper.unmount();
  }
});

test('format selection shows copyable direct URLs without starting a conversion', async () => {
  vi.mocked(request).mockResolvedValue({
    modelId: 'first',
    warnings: [],
    formats: [
      {
        format: 'gltf',
        entrypoint: 'scenes/My model.gltf',
        source: 'original',
        cached: true,
        warnings: [],
      },
      { format: 'glb', entrypoint: 'model.glb', source: 'converted', cached: false, warnings: [] },
      {
        format: 'xgfstream',
        entrypoint: 'index.runtime.json',
        source: 'converted',
        cached: false,
        warnings: [],
      },
    ],
  });
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  const wrapper = setup();
  const field = () =>
    wrapper.get('textarea[aria-label="Model URL"]').element as HTMLTextAreaElement;
  try {
    await flushPromises();
    expect(field().readOnly).toBe(true);
    expect(field().value).toBe(location.origin + '/models/first/formats/glb/files/model.glb');
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'xgfstream');
    await flushPromises();
    expect(field().value).toBe(
      location.origin + '/models/first/formats/xgfstream/files/index.runtime.json',
    );
    expect(wrapper.text()).toContain('Stream manifest');
    await wrapper.get('[aria-label="Copy model URL"]').trigger('click');
    expect(clipboard).toHaveBeenCalledWith(field().value);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/api/models/first/formats');
    expect(change).not.toHaveBeenCalled();
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'gltf');
    await flushPromises();
    expect(field().value).toContain('/gltf/files/scenes/My%20model.gltf');
    expect(wrapper.find('.format-download').exists()).toBe(false);
    clipboard.mockRejectedValueOnce(new Error('Clipboard denied'));
    await wrapper.get('[aria-label="Copy model URL"]').trigger('click');
    await flushPromises();
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe(field().value.length);
  } finally {
    wrapper.unmount();
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('DataModel has its own label and copyable URL, and downloads JSON rather than the geometry package', async () => {
  vi.mocked(request).mockResolvedValue({
    modelId: 'first',
    warnings: [],
    formats: [
      {
        format: 'datamodel',
        entrypoint: 'model.datamodel.json',
        source: 'converted',
        cached: false,
        warnings: ['Object types, properties and relationships. Contains no geometry.'],
      },
    ],
  });
  vi.mocked(change).mockResolvedValue({
    entrypoint: 'model.datamodel.json',
    files: [
      { path: 'model.datamodel.json', bytes: 400 },
      { path: 'provenance/credits.txt', bytes: 100 },
    ],
    warnings: [],
  });
  const clicked: { href: string; download: string }[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
  const wrapper = setup();
  try {
    await flushPromises();
    expect(wrapper.text()).toContain('xeokit DataModel JSON');
    expect(wrapper.text()).not.toContain('DataModelImporter');
    expect(change).not.toHaveBeenCalled();
    expect(
      (wrapper.get('textarea[aria-label="DataModel URL"]').element as HTMLTextAreaElement).value,
    ).toBe(location.origin + '/models/first/formats/datamodel/files/model.datamodel.json');
    expect(wrapper.get('button.format-download').text()).toBe('Download JSON');
    await wrapper.get('button.format-download').trigger('click');
    await flushPromises();
    expect(change).toHaveBeenCalledWith('/api/models/first/conversions/datamodel', 'POST');
    expect(clicked).toEqual([
      {
        href:
          location.origin +
          '/api/models/first/formats/datamodel/files/model.datamodel.json?download=1',
        download: 'model.datamodel.json',
      },
    ]);
    expect(wrapper.text()).toContain('Cached download');
  } finally {
    wrapper.unmount();
    click.mockRestore();
  }
});
