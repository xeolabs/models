import { ModelsError } from '../domain/ModelsError.js';

/**
 * Read only a configured server's file, with bounded allocation and no redirects.
 * The caller drops these bytes after the SDK staging writer has consumed them.
 */
async function readBytes(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new Error('Invalid scene asset byte limit');
  const abort = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
    : AbortSignal.timeout(120000);
  const response = await fetch(url, { signal: abort, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Read scene asset: HTTP ' + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Read scene asset: empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > maxBytes)
      throw new Error('Scene asset exceeds byte limit');
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error('Scene asset exceeds byte limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  abort.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Computes the lowercase SHA-256 of complete source bytes using Web Crypto. Browser callers require HTTPS or localhost.
 *
 * @param bytes - Complete file contents.
 * @returns A hexadecimal digest.
 */
export async function sceneAssetHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Keep transport failures within the client error contract, including cancellation.
 */
export async function readSceneAssetBytes(
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await readBytes(url, maxBytes, signal);
  } catch (cause) {
    if (cause instanceof ModelsError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    const name = cause instanceof Error ? cause.name : '';
    throw new ModelsError(
      name === 'AbortError'
        ? 'DOWNLOAD_CANCELLED'
        : name === 'TimeoutError'
          ? 'DOWNLOAD_TIMEOUT'
          : 'DOWNLOAD_FAILED',
      'Read scene asset: ' + message,
      { cause },
    );
  }
}
