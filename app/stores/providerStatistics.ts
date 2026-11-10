import { computed, ref, watch, type Ref } from 'vue';
import type {
  ProviderDownload,
  ProviderDownloadSummary,
  ProviderModelSummary,
} from '../../src/providers/types.js';
import type { AcquisitionApi } from '../data/AcquisitionApi';
export const providerKey = (model: ProviderModelSummary) => model.provider + ':' + model.remoteId;
export interface ModelFilters {
  format: string;
  resolution: string;
  maxBytes?: number;
  maxPolygons?: number;
  tag: string;
}

/**
 * Size filters apply to one complete package: the model and all its dependencies.
 * Unknown sizes never count as zero or pass an explicit size limit.
 */
export function packageBytes(
  download: ProviderDownload | ProviderDownloadSummary,
): number | undefined {
  if (!('files' in download)) return download.sizeBytes;
  if (download.files.some((file) => file.sizeBytes === undefined)) return undefined;
  return download.files.reduce((sum, file) => sum + file.sizeBytes!, 0);
}
export function matchingDownloads(
  downloads: (ProviderDownload | ProviderDownloadSummary)[],
  filters: ModelFilters,
) {
  return downloads.filter(
    (d) =>
      (filters.format === 'auto' || d.format === filters.format) &&
      (!filters.resolution || d.resolution === filters.resolution) &&
      (filters.maxBytes === undefined ||
        (packageBytes(d) !== undefined && packageBytes(d)! <= filters.maxBytes)),
  );
}
export function matchesModel(
  model: ProviderModelSummary,
  downloads: (ProviderDownload | ProviderDownloadSummary)[] | undefined,
  filters: ModelFilters,
) {
  if (filters.tag && !model.tags.includes(filters.tag)) return false;
  if (
    filters.maxPolygons !== undefined &&
    (model.statistics?.polygonCount === undefined ||
      model.statistics.polygonCount > filters.maxPolygons)
  )
    return false;
  if (filters.format !== 'auto' || filters.resolution || filters.maxBytes !== undefined)
    return !!downloads && matchingDownloads(downloads, filters).length > 0;
  return true;
}

/**
 * Read only download manifests, with two requests in flight. Abort stale result
 * batches so a slow previous search cannot replace current statistics.
 */
export function useProviderStatistics(api: AcquisitionApi, models: Ref<ProviderModelSummary[]>) {
  const downloads = ref<Record<string, ProviderDownloadSummary[]>>({}),
    errors = ref<Record<string, string>>({}),
    loading = ref(false);
  let active: AbortController | undefined;
  const pendingCount = computed(
    () =>
      models.value.filter(
        (model) => !downloads.value[providerKey(model)] && !errors.value[providerKey(model)],
      ).length,
  );
  async function refresh() {
    active?.abort();
    const controller = (active = new AbortController());
    const pending = models.value.filter((model) => !downloads.value[providerKey(model)]);
    errors.value = {};
    loading.value = pending.length > 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, pending.length) }, async () => {
        while (!controller.signal.aborted && next < pending.length) {
          const model = pending[next++],
            key = providerKey(model);
          try {
            const result =
              model.downloadOptions ??
              (await api.downloads(model.provider, model.remoteId, controller.signal)).map(
                (download) => ({
                  id: download.id,
                  format: download.format,
                  resolution: download.resolution,
                  sizeBytes: packageBytes(download),
                  fileCount: download.files.length,
                }),
              );
            if (!controller.signal.aborted) downloads.value[key] = result;
          } catch (e) {
            if (!controller.signal.aborted) errors.value[key] = (e as Error).message;
          }
        }
      }),
    );
    if (!controller.signal.aborted) loading.value = false;
  }
  watch(models, () => void refresh());
  function dispose() {
    active?.abort();
  }
  return { downloads, errors, loading, pendingCount, refresh, dispose };
}
