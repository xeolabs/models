import os from 'node:os';
import { ModelsError, fail } from '../domain/ModelsError.js';
import type { ModelsErrorCode } from '../domain/ModelsError.js';
import { ProcessingRepository } from './ProcessingRepository.js';
import type {
  ProcessingJob,
  ProcessingKind,
  ProcessingOverview,
  ProcessingProgress,
} from './types.js';

/**
 * Persistent jobs are separate from the request waiting for their output.
 * Closing the library stops its own worker; queued jobs remain for the next server.
 */
export class ProcessingQueue {
  private timer?: ReturnType<typeof setInterval>;
  private active?: { id: string; controller: AbortController; promise: Promise<void> };
  private closed = false;
  private claiming = false;
  private readonly removedJobs = new Set<string>();
  constructor(
    readonly repository: ProcessingRepository,
    private readonly work: (
      job: ProcessingJob,
      signal: AbortSignal,
      report: (progress: ProcessingProgress) => void,
    ) => Promise<void>,
    background = true,
  ) {
    if (background) {
      this.timer = setInterval(async () => await this.tick(), 500);
      this.timer.unref();
    }
  }
  async enqueue(
    modelId: string,
    kind: ProcessingKind,
    format: string,
    source: 'automatic' | 'requested' = 'requested',
  ) {
    const job = await this.repository.db.transaction(
      async () => await this.repository.enqueue(modelId, kind, format, source),
    );
    return job;
  }
  async tick(jobId?: string) {
    if (this.closed || this.active || this.claiming) return;
    this.claiming = true;
    let job: ProcessingJob | null;
    try {
      job = await this.repository.claim(this.timer ? undefined : jobId);
    } catch {
      return;
    } finally {
      this.claiming = false;
    }
    if (!job) return;
    if (this.closed) {
      await this.repository.finish(job.id, 'interrupted');
      return;
    }
    const controller = new AbortController();
    const id = job.id;
    const monitor = setInterval(async () => {
      try {
        const current = await this.repository.get(id);
        if (!current || current.status === 'cancelling') controller.abort();
        else await this.repository.progress(id);
      } catch {
        controller.abort();
      }
    }, 250);
    const promise = Promise.resolve()
      .then(
        async () =>
          await this.work(job!, controller.signal, (progress) => {
            void this.repository.progress(id, progress).catch(() => controller.abort());
          }),
      )
      .then(async () => {
        if (controller.signal.aborted || (await this.repository.get(id))?.status === 'cancelling')
          throw new ModelsError('CONVERSION_CANCELLED', 'Conversion cancelled');
        await this.repository.finish(id, 'completed');
      })
      .catch(async (error) => {
        const interrupted = this.closed;
        const cancelled =
          controller.signal.aborted || (await this.repository.get(id))?.status === 'cancelling';
        await this.repository.finish(
          id,
          interrupted ? 'interrupted' : cancelled ? 'cancelled' : 'failed',
          cancelled
            ? 'CONVERSION_CANCELLED'
            : error instanceof ModelsError
              ? error.code
              : 'CONVERSION_FAILED',
          interrupted
            ? 'Server stopped. Retry to continue.'
            : error instanceof Error
              ? error.message
              : String(error),
        );
      })
      .finally(() => {
        clearInterval(monitor);
        this.active = undefined;
        if (!this.closed && this.timer) setImmediate(async () => await this.tick());
      });
    // The waiting API reports job failures; a timer must never reject unobserved.
    void promise.catch(() => controller.abort());
    this.active = { id, controller, promise };
  }
  async wait(id: string) {
    for (;;) {
      if (this.closed) fail('CONVERSION_CANCELLED', 'Conversion stopped with the library');
      const job = await this.repository.get(id);
      if (!job)
        fail(
          this.removedJobs.has(id) ? 'CONVERSION_CANCELLED' : 'MODEL_NOT_FOUND',
          'Conversion model was deleted',
        );
      if (job.status === 'completed') return;
      if (['failed', 'cancelled', 'interrupted'].includes(job.status))
        throw new ModelsError(
          (job.errorCode ??
            (job.status === 'cancelled'
              ? 'CONVERSION_CANCELLED'
              : 'CONVERSION_FAILED')) as ModelsErrorCode,
          job.error ?? 'Conversion ' + job.status,
        );
      await this.tick(id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async cancel(id: string) {
    await this.repository.cancel(id);
    if (this.active?.id === id) this.active.controller.abort();
  }
  async cancelModel(id: string) {
    for (const job of await this.repository.list(id))
      if (['queued', 'running', 'cancelling'].includes(job.status)) this.removedJobs.add(job.id);
    if (this.active && (await this.repository.get(this.active.id))?.modelId === id)
      this.active.controller.abort();
  }
  async overview(modelId?: string): Promise<ProcessingOverview> {
    const settings = await this.repository.settings(),
      freeMemoryBytes = os.freemem();
    return {
      settings,
      jobs: await this.repository.list(modelId),
      counts: await this.repository.counts(),
      freeMemoryBytes,
      workerLimit: 1,
      resourceMonitoring: process.platform === 'linux' ? 'linux' : 'portable',
      waitingReason: settings.paused
        ? 'Queue paused'
        : freeMemoryBytes < settings.reserveMemoryMiB * 1024 ** 2
          ? 'Waiting for free memory'
          : undefined,
    };
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    while (this.claiming) await new Promise((resolve) => setTimeout(resolve, 10));
    this.active?.controller.abort();
    await this.active?.promise.catch(() => {});
  }
}
