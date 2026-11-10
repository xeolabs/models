import type { ModelRepresentationFormat } from '../conversion/ModelFormats.js';

export function encodeModelFilePath(name: string): string {
  if (
    !name ||
    /[\\\x00]/.test(name) ||
    name.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Model file paths must stay inside their package.');
  return name.split('/').map(encodeURIComponent).join('/');
}

/**
 * Shared links address the actual entry file, so relative buffers, textures and
 * stream chunks keep working without redirects or a catalog API request.
 */
export function modelHotloadUrl(
  baseUrl: string,
  modelId: string,
  format: ModelRepresentationFormat,
  entrypoint: string,
): string {
  return (
    baseUrl.replace(/\/$/, '') +
    '/models/' +
    encodeURIComponent(modelId) +
    '/formats/' +
    encodeURIComponent(format) +
    '/files/' +
    encodeModelFilePath(entrypoint)
  );
}
