import { setTimeout as delay } from 'node:timers/promises';
import type { ProviderId } from './types.js';

/**
 * Pacing applies to metadata and downloads together, including retries.
 */
export class ProviderGate {
  private readonly tails = new Map<ProviderId, Promise<void>>();
  constructor(private readonly interval: Partial<Record<ProviderId, number>> = {}) {}
  async enter(provider: ProviderId, signal?: AbortSignal): Promise<() => void> {
    const previous = this.tails.get(provider) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      provider,
      previous.then(() => next),
    );
    let onAbort: (() => void) | undefined;
    try {
      signal?.throwIfAborted();
      await Promise.race([
        previous,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(signal?.reason ?? new Error('Cancelled'));
          signal?.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
      signal?.throwIfAborted();
    } catch (error) {
      release();
      throw error;
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
    return () => {
      void delay(this.interval[provider] ?? (provider === 'polyhaven' ? 300 : 1000)).then(release);
    };
  }
}
