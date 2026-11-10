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
      this.timer = setInterval(() => this.tick(), 500);
      this.timer.unref();
    }
  }
  enqueue(
    modelId: string,
    kind: ProcessingKind,
    format: string,
    source: 'automatic' | 'requested' = 'requested',
  ) {
    const job = this.repository.db.transaction(() =>
      this.repository.enqueue(modelId, kind, format, source),
    );
    return job;
  }
  tick(jobId?: string) {
    if (this.closed || this.active) return;
    let job: ProcessingJob | null;
    try {
      job = this.repository.claim(this.timer ? undefined : jobId);
    } catch {
      return;
    }
    if (!job) return;
    const controller = new AbortController();
    const id = job.id;
    const monitor = setInterval(() => {
      const current = this.repository.get(id);
      if (!current || current.status === 'cancelling') controller.abort();
      else this.repository.progress(id);
    }, 250);
    const promise = Promise.resolve()
      .then(() =>
        this.work(job!, controller.signal, (progress) => this.repository.progress(id, progress)),
      )
      .then(() => {
        if (controller.signal.aborted || this.repository.get(id)?.status === 'cancelling')
          throw new ModelsError('CONVERSION_CANCELLED', 'Conversion cancelled');
        this.repository.finish(id, 'completed');
      })
      .catch((error) => {
        const interrupted = this.closed;
        const cancelled =
          controller.signal.aborted || this.repository.get(id)?.status === 'cancelling';
        this.repository.finish(
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
        if (!this.closed && this.timer) setImmediate(() => this.tick());
      });
    this.active = { id, controller, promise };
  }
  async wait(id: string) {
    for (;;) {
      if (this.closed) fail('CONVERSION_CANCELLED', 'Conversion stopped with the library');
      const job = this.repository.get(id);
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
      this.tick(id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  cancel(id: string) {
    this.repository.cancel(id);
    if (this.active?.id === id) this.active.controller.abort();
  }
  cancelModel(id: string) {
    for (const job of this.repository.list(id))
      if (['queued', 'running', 'cancelling'].includes(job.status)) this.removedJobs.add(job.id);
    if (this.active && this.repository.get(this.active.id)?.modelId === id)
      this.active.controller.abort();
  }
  overview(modelId?: string): ProcessingOverview {
    const settings = this.repository.settings(),
      freeMemoryBytes = os.freemem();
    return {
      settings,
      jobs: this.repository.list(modelId),
      counts: this.repository.counts(),
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
    this.active?.controller.abort();
    await this.active?.promise;
  }
}
