import type { ConversionFormat } from './types.js';

/**
 * Discovery and the SDK exporter use the same filenames. A link can be shown
 * before the converted model has been generated.
 */
export function conversionEntrypoint(format: ConversionFormat): string {
  if (format === 'datamodel') return 'model.datamodel.json';
  if (format === 'xgfstream') return 'index.runtime.json';
  return 'model.' + (format === 'cityjson' ? 'city.json' : format);
}
