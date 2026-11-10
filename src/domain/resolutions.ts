
/**
 * Provider resolution names are labels, not a fixed list of sizes we generate ourselves.
 */
export const resolutionPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Put familiar pixel sizes in ascending order, with other provider labels sorted by name.
 */
export function compareResolutions(a: string, b: string): number {
  const pixels = (value: string) => {
    const size = /^(\d+(?:\.\d+)?)(k|px)?$/i.exec(value);
    if (size) return Number(size[1]) * (size[2]?.toLowerCase() === 'k' ? 1024 : 1);
    const dimensions = /^(\d+)x(\d+)$/i.exec(value);
    return dimensions ? Math.max(Number(dimensions[1]), Number(dimensions[2])) : Infinity;
  };
  return pixels(a) - pixels(b) || a.localeCompare(b, 'en', { numeric: true });
}
