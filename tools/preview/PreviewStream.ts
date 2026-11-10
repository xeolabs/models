import { XGFViewStreamController } from '@xeokit/sdk/formats/xgfstream/view/XGFViewStreamController';
import { readXGFStreamingRuntimeIndex } from '@xeokit/sdk/formats/xgfstream/index/readXGFStreamingRuntimeIndex';
import { readXGFStreamingIndex } from '@xeokit/sdk/formats/xgfstream/index/readXGFStreamingIndex';
import type { SceneModel } from '@xeokit/sdk/model/scene';
import type { View } from '@xeokit/sdk/viewing/viewer';
import type { PreviewProgress } from '../../app/preview/types';
import type { PreviewCamera } from './PreviewCamera';
import { must, readBytes, resourceUrl } from './runtime';

/**
 * The SDK schedules visible chunks. It retains no downloaded file cache here,
 * and closing aborts both the first load and later camera-driven requests.
 */
export class PreviewStream {
  private controller?: XGFViewStreamController;
  private readonly stops: (() => void)[] = [];
  private readonly abort = new AbortController();
  private failed = false;
  constructor(
    private readonly onError: (error: Error) => void,
    private readonly onContent: () => Promise<void>,
  ) {}
  async load(
    url: string,
    model: SceneModel,
    view: View,
    camera: PreviewCamera,
    signal: AbortSignal,
    progress: (value: PreviewProgress) => void,
  ) {
    const combined = AbortSignal.any([signal, this.abort.signal]);
    const bytes = await readBytes(url, combined);
    const json = JSON.parse(new TextDecoder().decode(bytes));
    const index = must(
      json.format === 'XGFStreamingRuntimeIndex'
        ? readXGFStreamingRuntimeIndex(json)
        : readXGFStreamingIndex(json),
    );
    combined.throwIfAborted();
    camera.setModel(model, index);
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const fail = (error: unknown) => {
        if (combined.aborted) return;
        const cause = error instanceof Error ? error : new Error(String(error));
        this.failed = true;
        if (!ready) reject(cause);
        else this.onError(cause);
      };
      const cancelled = () => reject(combined.reason);
      combined.addEventListener('abort', cancelled, { once: true });
      this.controller = new XGFViewStreamController({
        index,
        sceneModel: model,
        view,
        streamIndexBaseURI: url,
        batchSize: 4,
        fetchConcurrency: 3,
        progressCadenceMs: 80,
        commitFrameBudgetMs: 8,
        frustumOnly: true,
        minProjectedChunkSizePixels: 2,
        cameraDebounceMs: 100,
        enableLRUEviction: true,
        maxResidentChunks: 96,
        cacheFileData: false,
        getStreamIndex: async (stream, childSignal) =>
          JSON.parse(
            new TextDecoder().decode(
              await readBytes(
                resourceUrl(stream.uri, url),
                AbortSignal.any([combined, ...(childSignal ? [childSignal] : [])]),
              ),
            ),
          ),
        loadOptions: {
          signal: combined,
          getFileData: (chunk, chunkSignal) =>
            readBytes(
              resourceUrl(chunk.uri!, url),
              AbortSignal.any([combined, ...(chunkSignal ? [chunkSignal] : [])]),
            ),
        },
        onProgress: ({ loaded, queued }) => {
          if (combined.aborted || this.failed) return;
          progress({
            message: loaded < queued ? 'Streaming visible parts…' : '',
            current: loaded,
            total: queued,
          });
          if (loaded >= queued && !ready) {
            ready = true;
            combined.removeEventListener('abort', cancelled);
            resolve();
          }
        },
        onError: fail,
        onChunkLoaded: () => {
          if (!combined.aborted) void this.onContent().catch(fail);
        },
        onChunkLoadStats: (stats) => {
          if (!stats.ok) fail(new Error(stats.error || 'A model chunk could not be loaded.'));
        },
      });
      const moved = (sender: unknown) => {
        if (sender === view || sender === view.camera) this.controller?.schedule();
      };
      this.stops.push(
        view.viewer.events.onCameraViewMatrixUpdated.subscribe(moved),
        view.viewer.events.onCameraProjMatrixUpdated.subscribe(moved),
      );
      this.controller.schedule();
    });
  }
  async pause(value: boolean) {
    if (value) {
      this.controller?.pause();
      while (this.controller?.running && !this.abort.signal.aborted)
        await new Promise((resolve) => setTimeout(resolve, 16));
    } else this.controller?.resume();
  }
  async destroy() {
    this.abort.abort();
    this.stops.splice(0).forEach((stop) => stop());
    const controller = this.controller;
    controller?.destroy();
    // A chunk commit can already be yielding inside the SDK. Let it settle before
    // its SceneModel is destroyed or reused for another preview.
    while (controller?.running) await new Promise((resolve) => setTimeout(resolve, 16));
    this.controller = undefined;
  }
}
