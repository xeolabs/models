import type { SceneModel } from '@xeokit/sdk/model/scene';

/**
 * Detect textures in the loaded SDK model, including textures arriving in chunks.
 * Report them once per opening, and keep that decision if chunks are later evicted.
 */
export class PreviewTextures {
  private pending?: Promise<void>;

  constructor(
    private readonly model: Pick<SceneModel, 'textures'>,
    private readonly signal: AbortSignal,
    private readonly onTextures: () => Promise<void>,
  ) {}

  async check(): Promise<void> {
    if (this.signal.aborted) return;
    if (!this.pending && Object.keys(this.model.textures).length > 0) {
      this.pending = Promise.resolve().then(() => {
        if (!this.signal.aborted) return this.onTextures();
      });
    }
    await this.pending;
  }
}
