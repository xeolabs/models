import {
  useProviderStatistics,
  matchingDownloads,
  matchesModel,
  packageBytes,
} from './providerStatistics';
import { providerIds, providerInfo } from '../../src/providers/ProviderInfo.js';
import { useProviderResolutions } from './providerResolutions';
import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { AcquisitionApi, type JobDetails } from '../data/AcquisitionApi';
import type { ProviderId, ProviderInfo, ProviderModelSummary } from '../../src/providers/types.js';
import type { AcquisitionPlan, AcquisitionJob } from '../../src/acquisition/types.js';

/**
 * Remote discovery, plan review and job polling stay independent from local catalog navigation.
 */
export const useAcquisition = defineStore('acquisition', () => {
  const api = new AcquisitionApi();
  const providers = ref<ProviderInfo[]>(providerIds.map((id) => ({ ...providerInfo[id] })));
  const info = (id: ProviderId) => providers.value.find((p) => p.id === id);
  const canAcquire = (id: ProviderId) => info(id)?.acquisition === 'direct';
  const providerName = (id: ProviderId) => info(id)?.name ?? id;
  const canPlan = computed(() => provider.value === 'all' || canAcquire(provider.value));
  const providerNotice = computed(() =>
    provider.value === 'all' ? '' : info(provider.value)?.notice,
  );
  const text = ref(''),
    provider = ref<ProviderId | 'all'>('all'),
    format = ref('auto'),
    maxModels = ref(20);
  const results = ref<ProviderModelSummary[]>([]),
    selection = ref<string[]>([]),
    providerErrors = ref<{ provider: ProviderId; message: string }[]>([]);
  const plan = ref<AcquisitionPlan | null>(null),
    job = ref<JobDetails | null>(null),
    plans = ref<AcquisitionPlan[]>([]),
    jobs = ref<AcquisitionJob[]>([]);
  const pendingReview = ref<{ kind: 'create' | 'plan' | 'job'; id?: string } | null>(null);
  const busy = computed(() => working.value || pendingReview.value !== null);
  const reviewMessage = computed(() =>
    pendingReview.value?.kind === 'create'
      ? 'Creating plan…'
      : pendingReview.value?.kind === 'job'
        ? 'Loading job…'
        : 'Loading plan…',
  );
  const working = ref(false),
    searching = ref(false),
    error = ref(''),
    searched = ref(false);
  let controller: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    activeJob = '',
    reviewVersion = 0;
  const key = (m: ProviderModelSummary) => m.provider + ':' + m.remoteId;
  const selectedModels = computed(() =>
    results.value.filter((m) => canAcquire(m.provider) && selection.value.includes(key(m))),
  );
  const statistics = useProviderStatistics(api, results);
  const filterResolution = ref(''),
    maxDownloadMiB = ref<number | undefined>(),
    maxPolygons = ref<number | undefined>(),
    filterTag = ref(''),
    resultSort = ref('name'),
    selectionNotice = ref('');
  const filters = computed(() => ({
    format: format.value,
    resolution: filterResolution.value,
    maxBytes: maxDownloadMiB.value ? Math.floor(maxDownloadMiB.value * 1024 ** 2) : undefined,
    maxPolygons: maxPolygons.value,
    tag: filterTag.value,
  }));
  const filtersActive = computed(
    () =>
      format.value !== 'auto' ||
      !!filterResolution.value ||
      maxDownloadMiB.value !== undefined ||
      maxPolygons.value !== undefined ||
      !!filterTag.value,
  );
  const resultTags = computed(() =>
    [...new Set(results.value.flatMap((model) => model.tags))].sort(),
  );
  const resultResolutions = computed(() =>
    [
      ...new Set(
        Object.values(statistics.downloads.value).flatMap((sets) =>
          sets
            .filter((d) => format.value === 'auto' || d.format === format.value)
            .map((d) => d.resolution),
        ),
      ),
    ].sort((a, b) => parseInt(a) - parseInt(b)),
  );
  const visibleResults = computed(() => {
    const filtered = results.value.filter((model) =>
      matchesModel(model, statistics.downloads.value[key(model)], filters.value),
    );
    const size = (model: ProviderModelSummary) => {
      const values = matchingDownloads(statistics.downloads.value[key(model)] ?? [], filters.value)
        .map(packageBytes)
        .filter((value): value is number => value !== undefined);
      return values.length ? Math.min(...values) : undefined;
    };
    return filtered.sort((a, b) => {
      if (resultSort.value !== 'name') {
        const av = resultSort.value === 'polygons' ? a.statistics?.polygonCount : size(a),
          bv = resultSort.value === 'polygons' ? b.statistics?.polygonCount : size(b);
        if (av === undefined && bv !== undefined) return 1;
        if (bv === undefined && av !== undefined) return -1;
        if (av !== undefined && bv !== undefined && av !== bv)
          return resultSort.value === 'size-desc' ? bv - av : av - bv;
      }
      return a.name.localeCompare(b.name) || key(a).localeCompare(key(b));
    });
  });
  const sizes = useProviderResolutions(api, selectedModels, format, statistics);
  watch(filters, () => {
    if (selection.value.length)
      selectionNotice.value = 'Selection cleared because the filters changed.';
    selection.value = [];
  });
  function selectVisible() {
    selection.value = visibleResults.value
      .filter((model) => canAcquire(model.provider))
      .slice(0, maxModels.value)
      .map(key);
    selectionNotice.value = '';
  }
  function resetFilters() {
    format.value = 'auto';
    filterResolution.value = '';
    maxDownloadMiB.value = undefined;
    maxPolygons.value = undefined;
    filterTag.value = '';
  }

  function toggle(m: ProviderModelSummary) {
    if (!canAcquire(m.provider)) return;
    const id = key(m);
    selection.value = selection.value.includes(id)
      ? selection.value.filter((v) => v !== id)
      : [...selection.value, id];
  }
  async function action(work: () => Promise<void>) {
    error.value = '';
    working.value = true;
    try {
      await work();
    } catch (cause) {
      error.value = (cause as Error).message;
    } finally {
      working.value = false;
    }
  }
  async function search() {
    controller?.abort();
    controller = new AbortController();
    const current = controller;
    searching.value = true;
    error.value = '';
    try {
      const found = await api.search(
        text.value,
        provider.value === 'all' ? providers.value.map((p) => p.id) : [provider.value],
        current.signal,
      );
      if (current.signal.aborted) return;
      results.value = found.items;
      providerErrors.value = found.providerErrors;
      selection.value = [];
      selectionNotice.value = '';
      searched.value = true;
    } catch (cause) {
      if (!current.signal.aborted) error.value = (cause as Error).message;
    } finally {
      if (!current.signal.aborted) searching.value = false;
    }
  }
  async function refresh() {
    await action(async () => {
      const [p, j, available] = await Promise.all([api.plans(), api.jobs(), api.providers()]);
      providers.value = available;
      plans.value = p.items;
      jobs.value = j.items;
    });
  }

  /**
   * Keep the last successful review visible until its replacement is ready.
   * Only the latest request can replace it; a failed request restores its controls and polling.
   */
  async function replaceReview(
    pending: NonNullable<typeof pendingReview.value>,
    load: () => Promise<{ plan: AcquisitionPlan } | { job: JobDetails }>,
  ) {
    const version = ++reviewVersion;
    pendingReview.value = pending;
    error.value = '';
    activeJob = '';
    clearTimeout(timer);
    try {
      const next = await load();
      if (disposed || version !== reviewVersion) return;
      if ('plan' in next) {
        plan.value = next.plan;
        job.value = null;
        if (!plans.value.some((saved) => saved.id === next.plan.id))
          plans.value = [next.plan, ...plans.value];
      } else {
        job.value = next.job;
        jobs.value = [next.job, ...jobs.value.filter((saved) => saved.id !== next.job.id)];
      }
    } catch (cause) {
      if (!disposed && version === reviewVersion) error.value = (cause as Error).message;
    } finally {
      if (version === reviewVersion) {
        pendingReview.value = null;
        if (!disposed && job.value && ['pending', 'running'].includes(job.value.status)) {
          activeJob = job.value.id;
          timer = setTimeout(() => void poll(activeJob), 1000);
        }
      }
    }
  }
  async function createPlan() {
    if (!canPlan.value) {
      error.value =
        info(provider.value as ProviderId)?.notice ??
        'This provider offers website downloads only.';
      return;
    }
    if (!filterResolution.value && !sizes.valid.value) {
      error.value = 'Select at least one available resolution, or choose all available sizes.';
      return;
    }
    const selected = selectedModels.value.length
      ? selectedModels.value
      : filtersActive.value
        ? visibleResults.value
            .filter((model) => canAcquire(model.provider))
            .slice(0, maxModels.value)
        : [];
    if (filtersActive.value && !selected.length) {
      error.value = 'No models match the filters.';
      return;
    }
    await replaceReview({ kind: 'create' }, async () => ({
      plan: await api.create({
        providers: selected.length
          ? [...new Set(selected.map((m) => m.provider))]
          : provider.value === 'all'
            ? providers.value.filter((p) => p.acquisition === 'direct').map((p) => p.id)
            : [provider.value],
        resolutions: filterResolution.value
          ? [filterResolution.value]
          : sizes.mode.value === 'all'
            ? 'all'
            : [...sizes.selected.value],
        maxPackageBytes: filters.value.maxBytes,
        maxPolygons: maxPolygons.value,
        format:
          format.value === 'auto'
            ? undefined
            : (format.value as 'gltf' | 'glb' | 'fbx' | 'blend' | 'ifc'),
        query: selected.length ? undefined : text.value,
        maxModels: maxModels.value,
        assets: selected.length
          ? selected.map((m) => ({ provider: m.provider, remoteId: m.remoteId }))
          : undefined,
      }),
    }));
  }
  async function choosePlan(id: string) {
    await replaceReview({ kind: 'plan', id }, async () => ({ plan: await api.plan(id) }));
  }
  async function poll(id: string) {
    const version = reviewVersion;
    clearTimeout(timer);
    try {
      const next = await api.job(id);
      if (disposed || activeJob !== id || version !== reviewVersion) return;
      job.value = next;
      const history = await api.jobs();
      if (disposed || activeJob !== id || version !== reviewVersion) return;
      jobs.value = history.items;
      if (next.status === 'running' || next.status === 'pending')
        timer = setTimeout(() => void poll(id), 1000);
    } catch (cause) {
      if (!disposed && activeJob === id && version === reviewVersion)
        error.value = (cause as Error).message;
    }
  }
  async function chooseJob(id: string) {
    await replaceReview({ kind: 'job', id }, async () => ({ job: await api.job(id) }));
  }
  async function execute() {
    if (!plan.value || pendingReview.value) return;
    const version = reviewVersion;
    await action(async () => {
      const started = await api.execute(plan.value!.id);
      if (disposed || version !== reviewVersion) return;
      activeJob = started.id;
      await poll(started.id);
    });
  }
  async function resume() {
    if (!job.value || pendingReview.value) return;
    const version = reviewVersion;
    await action(async () => {
      const started = await api.resume(job.value!.id);
      if (disposed || version !== reviewVersion) return;
      activeJob = started.id;
      await poll(started.id);
    });
  }
  async function cancel() {
    if (!job.value || pendingReview.value) return;
    const version = reviewVersion,
      id = job.value.id;
    await action(async () => {
      await api.cancel(id);
      if (disposed || version !== reviewVersion) return;
      await poll(id);
    });
  }
  function start() {
    disposed = false;
    void refresh();
    if (results.value.length) void statistics.refresh();
    if (job.value) void chooseJob(job.value.id);
  }
  function dispose() {
    disposed = true;
    reviewVersion++;
    pendingReview.value = null;
    activeJob = '';
    controller?.abort();
    sizes.dispose();
    statistics.dispose();
    clearTimeout(timer);
  }
  return {
    providers,
    visibleResults,
    filtersActive,
    filterResolution,
    maxDownloadMiB,
    maxPolygons,
    filterTag,
    resultSort,
    resultTags,
    resultResolutions,
    selectionNotice,
    selectVisible,
    resetFilters,
    downloadStatistics: statistics.downloads,
    statisticsErrors: statistics.errors,
    statisticsLoading: statistics.loading,
    statisticsPending: statistics.pendingCount,
    refreshStatistics: statistics.refresh,
    info,
    canAcquire,
    canPlan,
    providerName,
    providerNotice,
    text,
    provider,
    resolutionMode: sizes.mode,
    selectedResolutions: sizes.selected,
    resolutionChoices: sizes.choices,
    resolutionsLoading: sizes.loading,
    resolutionErrors: sizes.errors,
    resolutionsValid: sizes.valid,
    refreshResolutions: sizes.refresh,
    format,
    maxModels,
    results,
    selection,
    providerErrors,
    plan,
    job,
    plans,
    jobs,
    busy,
    pendingReview,
    reviewMessage,
    searching,
    error,
    searched,
    key,
    toggle,
    search,
    refresh,
    createPlan,
    choosePlan,
    chooseJob,
    execute,
    resume,
    cancel,
    start,
    dispose,
  };
});
