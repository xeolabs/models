import type { ModelFormat } from '../domain/types.js';
import type { ConversionFormat, ConvertedFile } from './types.js';

/**
 * Downloadable formats include generated packages as well as original source formats.
 * XGF Stream is a generated package. DataModel JSON contains semantic data,
 * not renderable geometry; both are generated outputs, not original import formats.
 */
export type ModelRepresentationFormat = ModelFormat | ConversionFormat;

/**
 * Original files are ready immediately. Converted formats are generated only
 * when requested; cached tells clients whether that work has already completed.
 */
export interface ModelFormatOption {
  format: ModelRepresentationFormat;
  entrypoint: string;
  source: 'original' | 'converted';
  cached: boolean;
  bytes?: number;
  warnings: string[];
}
export interface AvailableModelFormats {
  modelId: string;
  formats: ModelFormatOption[];
  warnings: string[];
}

/**
 * One usable format, including any companion files. Paths are relative to this
 * representation, so a viewer can resolve textures and buffers beside its entry point.
 */
export interface ModelFormatRepresentation {
  modelId: string;
  format: ModelRepresentationFormat;
  source: 'original' | 'converted';
  entrypoint: string;
  files: ConvertedFile[];
  warnings: string[];
  cached: boolean;
}
