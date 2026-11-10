import type { SDKResult } from '@xeokit/sdk/base/core';
import type { PreviewProgress } from '../../app/preview/types';

export function must<T>(result: SDKResult<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/**
 * Only files within this representation may be requested by a stream manifest.
 */
export function resourceUrl(name: string, entryUrl: string): string {
  const root = new URL('.', entryUrl),
    url = new URL(name, root);
  if (
    url.origin !== root.origin ||
    !url.pathname.startsWith(root.pathname) ||
    url.username ||
    url.password
  )
    throw new Error('The preview references a file outside its model package.');
  return url.href;
}

export async function readBytes(
  url: string,
  signal: AbortSignal,
  progress?: (value: PreviewProgress) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not load the model (HTTP ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || undefined;
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let received = 0,
    last = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (received > 512 * 1024 ** 2)
        throw new Error('This preview file exceeds the 512 MiB limit.');
      if (performance.now() - last > 80) {
        progress?.({ message: 'Downloading model…', current: received, total });
        last = performance.now();
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
