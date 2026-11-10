import { watch } from 'vue';
import { useModelPicker } from './useModelPicker';
import { useCatalog } from '../stores/catalog';
import { useAcquisition } from '../stores/acquisition';

/**
 * Give the job panel an initial usable choice as results arrive. Keep a user's
 * chosen model or resolution when polling updates the job. Loading still needs a click.
 */
export function useAcquiredModelSelection() {
  const picker = useModelPicker();
  const catalog = useCatalog();
  const remote = useAcquisition();
  let attempted = '';
  watch(
    () => [
      picker.enabled,
      picker.workspace,
      remote.pendingReview,
      remote.job?.id,
      picker.acquiredModels.map((item) => item.modelId).join(','),
      catalog.selected?.id,
      catalog.selecting,
      picker.selectingAcquiredId,
      picker.pending,
      picker.accepted,
    ],
    () => {
      if (
        !picker.enabled ||
        picker.workspace !== 'acquisition' ||
        remote.pendingReview ||
        catalog.selecting ||
        picker.selectingAcquiredId ||
        picker.pending ||
        picker.accepted
      )
        return;
      const choices = picker.acquiredModels;
      if (!choices.length) return;
      const first = choices[0];
      const key = remote.job!.id + ':' + first.modelId;
      if (choices.some((item) => item.modelId === catalog.selected?.id)) {
        attempted = key;
        return;
      }
      if (attempted === key) return;
      // A failed fetch needs an explicit retry, rather than one request per polling update.
      attempted = key;
      void picker.selectAcquired(first.modelId!);
    },
    { immediate: true },
  );
}
