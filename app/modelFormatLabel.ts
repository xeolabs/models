
/**
 * Keep display names separate from the lowercase format keys used by the API.
 */
export function modelFormatLabel(format: string | null | undefined): string | undefined {
  if (format == null) return undefined;
  if (format.toLowerCase() === 'datamodel') return 'xeokit DataModel JSON';
  if (format.toLowerCase() === 'gltf') return 'glTF';
  if (format.toLowerCase() === 'xgfstream') return 'XGF Stream';
  return format.toUpperCase();
}
