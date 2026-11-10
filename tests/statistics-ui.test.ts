// @vitest-environment jsdom
import { effectScope, ref, nextTick } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { expect, test } from 'vitest';
import { useProviderStatistics } from '../app/stores/providerStatistics';
import ModelStatistics from '../app/components/ModelStatistics.vue';
import { remote, fakeProvider } from './acquisition-helpers';
import type { AcquisitionApi } from '../app/data/AcquisitionApi';
test('cards show real package totals, file counts, formats and unavailable values', async () => {
  const downloads = await fakeProvider().getDownloads('oak');
  const wrapper = mount(ModelStatistics, {
    props: {
      model: { ...remote('oak'), statistics: { polygonCount: 5626 } },
      downloads,
      format: 'auto',
      resolution: '',
    },
  });
  expect(wrapper.text()).toContain('5,626');
  expect(wrapper.text()).toContain('glTF');
  expect(wrapper.find('tbody tr').exists()).toBe(true);
  await wrapper.setProps({
    model: remote('unknown'),
    downloads: undefined,
    error: 'Provider unavailable',
  });
  expect(wrapper.text()).toContain('Not supplied');
  expect(wrapper.text()).toContain('Unavailable');
  wrapper.unmount();
});
test('statistics load at most two requests and ignore responses from a replaced search', async () => {
  const models = ref([remote('a'), remote('b'), remote('c')]),
    pending: { id: string; resolve: (value: any) => void }[] = [];
  const scope = effectScope();
  const stats = scope.run(() =>
    useProviderStatistics(
      {
        downloads: (_p: string, id: string) =>
          new Promise((resolve) => pending.push({ id, resolve })),
      } as unknown as AcquisitionApi,
      models,
    ),
  )!;
  const first = stats.refresh();
  expect(pending).toHaveLength(2);
  models.value = [remote('new')];
  await nextTick();
  expect(pending.map((v) => v.id)).toEqual(['a', 'b', 'new']);
  pending[0].resolve([]);
  pending[1].resolve([]);
  pending[2].resolve([]);
  await first;
  await flushPromises();
  expect(stats.downloads.value['polyhaven:a']).toBeUndefined();
  expect(stats.downloads.value['polyhaven:new']).toEqual([]);
  stats.dispose();
  scope.stop();
});
