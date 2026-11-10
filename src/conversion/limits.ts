
/**
 * A stream contains many small chunks. Keep its file count bounded without using
 * the much smaller limit intended for imported archives from untrusted sources.
 */
export const CONVERSION_LIMITS = {
  files: 4096,
  bytes: 3 * 1024 ** 3,
} as const;
