import { ModelsError, type ModelsErrorCode } from '../domain/ModelsError.js';

/**
 * Bounds decompressed response bytes before parsing. HTTP compression must not
 * turn a small transfer into an unlimited allocation in the viewer.
 */
export async function readPropertyResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new ModelsError('INVALID_PROPERTY_QUERY', 'Properties: empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const text: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 9 * 1024 ** 2) {
        await reader.cancel();
        throw new ModelsError('PROPERTY_SET_TOO_LARGE', 'Properties: response exceeds 9 MiB');
      }
      text.push(decoder.decode(chunk.value, { stream: true }));
    }
    text.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  let envelope;
  try {
    envelope = JSON.parse(text.join(''));
  } catch (cause) {
    throw new ModelsError('INVALID_PROPERTY_QUERY', 'Properties: invalid server JSON', { cause });
  }
  if (!response.ok || envelope?.ok !== true)
    throw new ModelsError(
      (envelope?.error?.code ?? 'INVALID_PROPERTY_QUERY') as ModelsErrorCode,
      envelope?.error?.message ?? 'Property request failed',
    );
  return envelope.data;
}
