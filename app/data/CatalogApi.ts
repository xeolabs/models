import { request, readResponse } from './http';
import type { ModelRecord } from '../../src/domain/types.js';
export function change<T>(url: string, method: string, data?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: { 'X-Models-Action': 'explicit', 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  }).then(readResponse<T>);
}
export const modelUrl = (id: string) => '/api/models/' + encodeURIComponent(id);
export const fileUrl = (model: ModelRecord, name: string) =>
  modelUrl(model.id) + '/files/' + name.split('/').map(encodeURIComponent).join('/');
export { request };
