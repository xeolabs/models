import type { z } from 'zod';
import type { formats, metadataSchema, querySchema, manifestSchema } from './schema.js';
export type ModelFormat = (typeof formats)[number];
export type Metadata = z.output<typeof metadataSchema>;
export type ModelQuery = z.input<typeof querySchema>;
export type Manifest = z.input<typeof manifestSchema>;
export interface ModelFile {
  path: string;
  assetId: string;
  bytes: number;
  mime: string;
}
export interface ModelRecord {
  id: string;
  metadata: Metadata;
  entrypoint: string | null;
  format: ModelFormat | null;
  files: ModelFile[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}
export interface OpenLibraryOptions {
  processingWorker?: boolean;
  xeoIFC?: import('../conversion/XeoIFCRuntime.js').XeoIFCOptions;
  root: string;
  create?: boolean;
}
export interface Asset {
  id: string;
  bytes: number;
  mime: string;
  originalFilename: string;
  importedAt: string;
}
export interface ImportOptions {
  propertySetMode?: import('../properties/types.js').PropertySetMode;
  path: string;
  name?: string;
  description?: string;
  tags?: string[];
  source?: Metadata['source'];
  dryRun?: boolean;
}
export interface ImportReport {
  dryRun: boolean;
  model: ModelRecord | null;
  files: { path: string; sha256: string; bytes: number; reused: boolean }[];
  warnings: string[];
}
