import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { ServerModelsClient } from '../../src/browser/ServerModelsClient.js';
import {
  isPickerMessage,
  pickerMessage,
  readPickerRequest,
  validBrowseState,
  type ModelPickerRequest,
} from '../../src/browser/ModelPickerProtocol.js';
import { useCatalog } from '../stores/catalog';
import { useAcquisition } from '../stores/acquisition';
import { providerIds } from '../../src/providers/ProviderInfo.js';
import type { AcquisitionJobItem } from '../../src/acquisition/types.js';
import { setSessionTheme } from '../theme';

/**
 * Browsing stays in Models. Only an explicit selection is sent to the Studio window
 * that opened this request. Preparing a completed result never sends it to Studio.
 */
export const useModelPicker = defineStore('modelPicker', () => {
  const enabled = location.pathname.endsWith('/picker');
  const catalog = useCatalog();
  const remote = useAcquisition();
  const selectingAcquiredId = ref('');
  let acquiredSelectionVersion = 0;
  const connected = ref(false),
    pending = ref(false),
    accepted = ref(false),
    error = ref('');
  const workspace = ref<'library' | 'acquisition'>('library');
  let request: ModelPickerRequest | undefined;
  let receiver: Window | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let started = false;
  if (enabled) {
    try {
      request = readPickerRequest(location.search);
      catalog.compatibleFormats = request.formats;
      setSessionTheme(request.theme);
    } catch (cause) {
      error.value = (cause as Error).message;
    }
  }
  const targetOrigin = request?.origin ?? '';

  function supportsFormat(format: string): boolean {
    return !!request?.formats.includes(format);
  }
  function canChooseAcquired(item: AcquisitionJobItem): boolean {
    return (
      !!item.modelId &&
      ['completed', 'skipped'].includes(item.status) &&
      supportsFormat(item.format)
    );
  }
  const acquiredModels = computed(() => remote.job?.items.filter(canChooseAcquired) ?? []);

  // In the job panel, the footer must refer to a result of that job, not an older library choice.
  const selected = computed(() => {
    const model = catalog.selected;
    if (workspace.value === 'library') return model;
    if (remote.pendingReview || !acquiredModels.value.some((item) => item.modelId === model?.id))
      return null;
    return model;
  });
  const selectionPrompt = computed(() => {
    if (workspace.value === 'library') return 'Choose a model from the library';
    if (remote.pendingReview) return 'Loading acquisition results…';
    if (acquiredModels.value.length) return 'Choose an acquired model below';
    if (
      remote.job?.items.some(
        (item) => !!item.modelId && ['completed', 'skipped'].includes(item.status),
      )
    )
      return 'This job has no completed model in a format Studio can load';
    return 'A completed model will be selected here when it is ready';
  });
  const compatible = computed(
    () =>
      !!selected.value?.entrypoint &&
      !!selected.value.format &&
      supportsFormat(selected.value.format),
  );
  const canSelect = computed(
    () =>
      connected.value &&
      compatible.value &&
      !pending.value &&
      !accepted.value &&
      !catalog.selecting &&
      !selectingAcquiredId.value,
  );
  const bytes = computed(
    () => selected.value?.files.reduce((sum, file) => sum + file.bytes, 0) ?? 0,
  );

  function send(
    type: Parameters<typeof pickerMessage>[1],
    fields: Parameters<typeof pickerMessage>[2] = {},
  ) {
    if (receiver && request)
      receiver.postMessage(pickerMessage(request.requestId, type, fields), request.origin);
  }
  function receive(event: MessageEvent) {
    if (
      !request ||
      event.origin !== request.origin ||
      event.source !== receiver ||
      !isPickerMessage(event.data, request.requestId)
    )
      return;
    const message = event.data;
    if (message.type === 'connected') {
      connected.value = true;
      error.value = '';
      saveBrowseState();
    }
    if (message.type === 'accepted') {
      clearTimeout(timer);
      pending.value = false;
      accepted.value = true;
    }
    if (message.type === 'error' || message.type === 'ended') {
      clearTimeout(timer);
      pending.value = false;
      error.value =
        message.type === 'ended'
          ? 'This Studio selection has ended. Reopen Models library from Studio.'
          : message.message!;
      if (message.type === 'ended') connected.value = false;
    }
    if (message.type === 'theme') setSessionTheme(message.theme!);
  }
  async function start() {
    if (!enabled || !request || started) return;
    started = true;
    window.addEventListener('message', receive);
    receiver = window.parent !== window ? window.parent : window.opener;
    if (!receiver) {
      error.value = 'The Studio window is no longer connected. Reopen Models library from Studio.';
      return;
    }
    try {
      const client = await ServerModelsClient.open(location.origin, AbortSignal.timeout(10000));
      const capabilities = await client.pickerCapabilities(AbortSignal.timeout(10000));
      if (disposed) return;
      if (!capabilities.allowedOrigins.includes(request.origin))
        throw new Error('This Models server has not enabled the picker for this Studio origin.');
      send('ready');
      timer = setTimeout(() => {
        if (!connected.value)
          error.value = 'Studio did not respond. Reopen the picker from Studio.';
      }, 10000);
      if (request.selectedId) await catalog.select(request.selectedId, false);
      restoreBrowseState();
    } catch (cause) {
      if (!disposed) error.value = (cause as Error).message;
    }
  }
  function highlight() {
    accepted.value = false;
    if (selected.value && connected.value) send('highlight', { modelId: selected.value.id });
  }
  function select() {
    if (!canSelect.value || !selected.value) return;
    pending.value = true;
    error.value = '';
    send('select', { modelId: selected.value.id, updatedAt: selected.value.updatedAt });
    clearTimeout(timer);
    // Studio may need to prepare a cached format before accepting this selection.
    timer = setTimeout(() => {
      pending.value = false;
      error.value =
        'Studio has not acknowledged this selection. Check the Studio tab before trying again.';
    }, 300000);
  }
  function cancel() {
    if (!pending.value) send('cancel');
  }
  function returnToStudio() {
    // Browsers can decline a focus request; the visible confirmation still identifies the destination.
    receiver?.focus();
  }

  /**
   * Fetch the completed catalog record directly. Refreshing the whole catalog first
   * can fail independently and should not prevent choosing an acquired model.
   */
  async function selectAcquired(id: string) {
    if (pending.value) return;
    const version = ++acquiredSelectionVersion;
    selectingAcquiredId.value = id;
    accepted.value = false;
    error.value = '';
    try {
      await catalog.select(id, false);
      if (version !== acquiredSelectionVersion) return;
      if (catalog.selected?.id !== id)
        error.value = catalog.error || 'Could not select this acquired model. Try again.';
    } finally {
      if (version === acquiredSelectionVersion) selectingAcquiredId.value = '';
    }
  }
  async function chooseAcquired(id: string) {
    await selectAcquired(id);
    if (catalog.selected?.id !== id) return;
    workspace.value = 'library';
    catalog.mobilePanel = 'details';
    void catalog.refresh();
  }
  function saveBrowseState() {
    if (!request) return;
    try {
      const browseState = {
        workspace: workspace.value,
        selectedId: selected.value?.id,
        jobId: remote.job?.id,
        planId: remote.plan?.id,
        libraryText: catalog.text,
        remoteText: remote.text,
        remoteProvider: remote.provider,
      };
      sessionStorage.setItem('models.picker.' + request.requestId, JSON.stringify(browseState));
      if (connected.value) send('browse', { browseState });
    } catch {

      /*
       * Browsing still works when browser storage is unavailable.
       */
    }
  }
  function restoreBrowseState() {
    if (!request) return;
    try {
      const saved =
        request.browseState ??
        JSON.parse(sessionStorage.getItem('models.picker.' + request.requestId) ?? 'null');
      if (!validBrowseState(saved)) return;
      remote.text = saved.remoteText;
      if (
        saved.remoteProvider === 'all' ||
        providerIds.includes(saved.remoteProvider as (typeof providerIds)[number])
      )
        remote.provider = saved.remoteProvider as typeof remote.provider;
      if (saved.workspace === 'acquisition') workspace.value = 'acquisition';
      catalog.text = saved.libraryText;
      if (!request.selectedId && typeof saved.selectedId === 'string')
        void catalog.select(saved.selectedId, false);
      if (saved.jobId) void remote.chooseJob(saved.jobId);
      else if (saved.planId) void remote.choosePlan(saved.planId);
    } catch {

      /*
       * An old or unavailable draft does not prevent a fresh selection.
       */
    }
  }
  function dispose() {
    saveBrowseState();
    disposed = true;
    clearTimeout(timer);
    window.removeEventListener('message', receive);
  }
  return {
    enabled,
    targetOrigin,
    connected,
    pending,
    accepted,
    error,
    workspace,
    compatible,
    selected,
    selectionPrompt,
    acquiredModels,
    selectingAcquiredId,
    selecting: computed(() => catalog.selecting || !!selectingAcquiredId.value),
    supportsFormat,
    canChooseAcquired,
    selectAcquired,
    canSelect,
    bytes,
    start,
    select,
    cancel,
    highlight,
    returnToStudio,
    chooseAcquired,
    saveBrowseState,
    dispose,
  };
});
