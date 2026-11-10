import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { ProviderModelSummary, ProviderDownloadSummary } from '../../src/providers/types.js';
import { compareResolutions } from '../../src/domain/resolutions.js';
import type { AcquisitionApi } from '../data/AcquisitionApi';

/**
 * Discover sizes for the selected models. Only two metadata requests run at once, and a
 * changed selection cannot be overwritten by an older response. No model files are downloaded.
 */
export function useProviderResolutions(
  _api: AcquisitionApi,
  models: ComputedRef<ProviderModelSummary[]>,
  format: Ref<string>,
  source: {
    downloads: Ref<Record<string, ProviderDownloadSummary[]>>;
    errors: Ref<Record<string, string>>;
    refresh: () => Promise<void>;
  },
) {
  const mode = ref<'all' | 'selected'>('all'),
    selected = ref<string[]>([]);
  const key = (model: ProviderModelSummary) => model.provider + ':' + model.remoteId;
  const loading = computed(() =>
    models.value.some(
      (model) => !source.downloads.value[key(model)] && !source.errors.value[key(model)],
    ),
  );
  const errors = computed(() =>
    models.value.flatMap((model) =>
      source.errors.value[key(model)] ? [model.name + ': ' + source.errors.value[key(model)]] : [],
    ),
  );
  const choices = computed(() => {
    const counts = new Map<string, number>();
    for (const model of models.value) {
      const sizes = new Set(
        (source.downloads.value[key(model)] ?? [])
          .filter((d) => format.value === 'auto' || d.format === format.value)
          .map((d) => d.resolution),
      );
      for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
    }
    return [...counts]
      .sort(([a], [b]) => compareResolutions(a, b))
      .map(([resolution, count]) => ({ resolution, count }));
  });
  const valid = computed(
    () =>
      mode.value === 'all' ||
      (!loading.value &&
        selected.value.length > 0 &&
        selected.value.every((size) => choices.value.some((choice) => choice.resolution === size))),
  );
  return { mode, selected, choices, loading, errors, valid, refresh: source.refresh, dispose() {} };
}
