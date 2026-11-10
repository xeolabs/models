export const conversionFormats = [
  'glb',
  'xgf',
  'xgfstream',
  'ifc',
  'obj',
  'ply',
  'stl',
  'fbx',
  'cityjson',
  'dxf',
  'e57',
  'xkt',
  'datamodel',
] as const;
export type ConversionFormat = (typeof conversionFormats)[number];
export interface ConversionOption {
  format: ConversionFormat;
  warnings: string[];
  cached: boolean;
  bytes?: number;
}
export interface ModelDownloadFormats {
  modelId: string;
  formats: ConversionOption[];
  message?: string;
}
export interface ConvertedFile {
  path: string;
  sha256: string;
  bytes: number;
}
export interface ConvertedModel {
  modelId: string;
  format: ConversionFormat;
  entrypoint: string;
  files: ConvertedFile[];
  warnings: string[];
  createdAt: string;
  cached: boolean;
}
export interface ConversionRequest {
  propertySetMode?: import('../properties/types.js').PropertySetMode;
  propertyModelId?: string;
  propertyRevision?: string;
  propertyTask?: 'externalize' | 'embed';
  propertyDatabaseFile?: string;
  makeThumbnail?: boolean;
  thumbnailOnly?: boolean;
  dataModelFile?: string;
  includeOptions?: boolean;
  sourceFormat: string;
  entrypoint: string;
  materialFiles: string[];
  output: string;
  format?: ConversionFormat;
}
