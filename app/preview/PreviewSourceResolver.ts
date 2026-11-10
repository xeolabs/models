import { ServerModelsClient } from '../../src/browser/ServerModelsClient.js';
import type { ModelRecord } from '../../src/domain/types.js';
import type { PreviewFormat, PreviewProgress, PreviewSource } from './types';
import type { AvailableModelFormats } from '../../src/conversion/ModelFormats.js';

export const LARGE_PREVIEW_BYTES = 128 * 1024 ** 2;

/**
 * File sizes are a useful fallback when a provider has no geometry statistics.
 * This threshold chooses transport; it does not alter the model's detail.
 */
export function previewFormats(
  model: ModelRecord,
  available: AvailableModelFormats,
): PreviewFormat[] {
  const offered = new Set(available.formats.map((item) => item.format));
  const bytes = Math.max(
    model.files.reduce((sum, file) => sum + file.bytes, 0),
    available.formats.find((item) => item.format === 'xgf')?.bytes ?? 0,
  );
  const preferred: PreviewFormat[] =
    bytes >= LARGE_PREVIEW_BYTES
      ? ['xgfstream', 'xgf', 'glb', 'gltf']
      : ['xgf', 'glb', 'gltf', 'xgfstream'];
  return preferred.filter((format) => offered.has(format));
}

/**
 * All model URLs come from the Models TypeScript client. A failed conversion can
 * fall back to another supported representation, but cancellation never retries.
 */
export class PreviewSourceResolver {
  constructor(
    private readonly connect = (signal: AbortSignal) =>
      ServerModelsClient.open(location.origin, signal),
  ) {}
  async resolve(
    model: ModelRecord,
    signal: AbortSignal,
    progress: (value: PreviewProgress) => void,
  ): Promise<PreviewSource> {
    progress({ message: 'Checking available formats…' });
    const client = await this.connect(signal);
    const available = await client.availableFormats(model.id, signal);
    const choices = previewFormats(model, available);
    if (!choices.length)
      throw new Error(
        'A 3D preview is not available for this model format. The original download is still available.',
      );
    let failure: unknown;
    for (const format of choices) {
      signal.throwIfAborted();
      progress({ message: 'Preparing the model…' });
      try {
        const representation = await client.getFormat(model.id, format, signal);
        signal.throwIfAborted();
        return { format, url: client.formatFileUrl(model.id, format, representation.entrypoint) };
      } catch (error) {
        signal.throwIfAborted();
        failure = error;
      }
    }
    throw failure;
  }
}
