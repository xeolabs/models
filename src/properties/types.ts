
/**
 * These definitions match xeokit SDK v3 PropertyParams and PropertySetParams.
 * They contain no catalog fields or renderer dependencies.
 */
export interface ModelProperty {
  name: string;
  value: unknown;
  type?: string;
  valueType?: string | number;
  description?: string;
}
export interface ModelPropertySet {
  id: string;
  originalSystemId?: string;
  name: string;
  type: string;
  schema?: string;
  properties: ModelProperty[];
}
export type PropertySetMode = 'embedded' | 'external';
export interface ModelPropertiesInfo {
  modelId: string;
  mode: PropertySetMode;
  ready: boolean;
  revision?: string;
  propertySetCount?: number;
  objectCount?: number;
}
export interface PropertySetQuery {
  ids: readonly string[];
  revision: string;
  cursor?: number;
}
export interface PropertySetPage {
  revision: string;
  propertySets: ModelPropertySet[];
  missingIds: string[];
  nextCursor?: number;
}
export interface ObjectPropertiesQuery {
  objectIds: readonly string[];
  revision: string;
  cursor?: string;
}
export interface ObjectPropertiesPage {
  revision: string;
  objects: { id: string; propertySetIds: string[] }[];
  missingObjectIds: string[];
  nextCursor?: string;
}
export interface PropertyObjectQuery {
  revision: string;
  propertyName: string;
  value: string | number | boolean | null;
  propertySetName?: string;
  after?: string;
  limit?: number;
}
export interface PropertyObjectPage {
  revision: string;
  objectIds: string[];
  nextCursor?: string;
}
