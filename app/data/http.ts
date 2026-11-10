
/**
 * Local server responses use one envelope, including failures.
 */
export async function request<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  return readResponse<T>(response);
}
export async function readResponse<T>(response: Response): Promise<T> {
  const envelope = await response.json();
  if (!response.ok || !envelope.ok)
    throw new Error(envelope.error?.message ?? `Request failed (${response.status})`);
  return envelope.data as T;
}
