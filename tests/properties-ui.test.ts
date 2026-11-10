// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { ElSelect } from 'element-plus';
import ModelProperties from '../app/components/ModelProperties.vue';
import { useProcessing } from '../app/stores/processing';

function envelope(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }));
}

test('storage changes are explicit, failed changes restore the current mode, and ready models offer offline exports', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const refresh = vi.spyOn(useProcessing(), 'refresh').mockResolvedValue();
  let mode = 'embedded';
  let fail = true;
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      if (fail)
        return new Response(
          JSON.stringify({ ok: false, error: { message: 'Model is processing' } }),
          { status: 409 },
        );
      mode = 'external';
    }
    return envelope({
      modelId: 'one',
      mode,
      ready: mode === 'external',
      revision: 'a'.repeat(64),
      propertySetCount: 12,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const wrapper = mount(ModelProperties, {
    props: { modelId: 'one' },
    global: { plugins: [pinia] },
  });
  try {
    await flushPromises();
    expect(wrapper.find('button').exists()).toBe(false);
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'external');
    await flushPromises();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Model is processing');
    expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe('embedded');
    fail = false;
    wrapper.findComponent(ElSelect).vm.$emit('update:modelValue', 'external');
    await flushPromises();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(refresh).toHaveBeenCalled();
    expect(wrapper.text()).toContain('12 property sets ready');
    expect(wrapper.get('a').attributes('href')).toBe(
      '/api/models/one/datamodel?properties=embedded&download=1',
    );
  } finally {
    wrapper.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test('switching models cancels stale property status responses', async () => {
  const pinia = createPinia();
  const pending: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise<Response>((resolve) => pending.push({ signal: options.signal, resolve })),
    ),
  );
  const wrapper = mount(ModelProperties, {
    props: { modelId: 'one' },
    global: { plugins: [pinia] },
  });
  try {
    await wrapper.setProps({ modelId: 'two' });
    expect(pending[0].signal.aborted).toBe(true);
    pending[1].resolve(envelope({ modelId: 'two', mode: 'embedded', ready: false }));
    await flushPromises();
    pending[0].resolve(
      envelope({ modelId: 'one', mode: 'external', ready: true, propertySetCount: 999 }),
    );
    await flushPromises();
    expect(wrapper.text()).not.toContain('999');
    expect(wrapper.findComponent(ElSelect).props('modelValue')).toBe('embedded');
  } finally {
    wrapper.unmount();
    vi.unstubAllGlobals();
  }
});
