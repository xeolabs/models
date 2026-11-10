export type AcquisitionErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_API_ERROR'
  | 'REMOTE_MODEL_NOT_FOUND'
  | 'DOWNLOAD_OPTION_NOT_FOUND'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_TIMEOUT'
  | 'DOWNLOAD_TOO_LARGE'
  | 'DOWNLOAD_CANCELLED'
  | 'RATE_LIMITED'
  | 'CHECKSUM_MISMATCH'
  | 'UNSUPPORTED_LICENSE'
  | 'UNSUPPORTED_MODEL_MAPPING'
  | 'ACQUISITION_ALREADY_EXISTS'
  | 'ACQUISITION_LIMIT_EXCEEDED'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_EXPIRED'
  | 'PLAN_STALE'
  | 'INVALID_PLAN'
  | 'JOB_NOT_FOUND'
  | 'JOB_CONFLICT'
  | 'INVALID_PROVIDER_RESPONSE';
export type ModelsErrorCode =
  | AcquisitionErrorCode
  | 'PROPERTY_SET_NOT_FOUND'
  | 'PROPERTIES_NOT_READY'
  | 'PROPERTY_REVISION_MISMATCH'
  | 'INVALID_PROPERTY_QUERY'
  | 'PROPERTY_SET_TOO_LARGE'
  | 'LIBRARY_NOT_FOUND'
  | 'LIBRARY_ALREADY_EXISTS'
  | 'LIBRARY_CLOSED'
  | 'LIBRARY_LOCKED'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_LIBRARY'
  | 'DATABASE_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_MODEL'
  | 'MODEL_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'UNSUPPORTED_PREVIEW_FORMAT'
  | 'UNSUPPORTED_FILE_ROLE'
  | 'AMBIGUOUS_MODEL_MAPPING'
  | 'INVALID_MODEL_MAPPING'
  | 'INVALID_BUNDLE'
  | 'HASH_MISMATCH'
  | 'PATH_OUTSIDE_ROOT'
  | 'FILE_IO_ERROR'
  | 'CONVERSION_FAILED'
  | 'CONVERSION_CANCELLED'
  | 'CONVERSION_TIMEOUT'
  | 'CONFLICT';
export class ModelsError extends Error {
  constructor(
    public readonly code: ModelsErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ModelsError';
  }
}
export function fail(code: ModelsErrorCode, message: string): never {
  throw new ModelsError(code, message);
}
export function wrap(error: unknown, operation: string): ModelsError {
  if (error instanceof ModelsError) return error;
  const e = error as { code?: string; message?: string };
  const code: ModelsErrorCode = /locked|busy/i.test(e.message ?? '')
    ? 'LIBRARY_LOCKED'
    : e.code?.startsWith('SQLITE') || e.code === 'ERR_SQLITE_ERROR'
      ? 'DATABASE_ERROR'
      : 'FILE_IO_ERROR';
  return new ModelsError(code, `${operation}: ${e.message ?? String(error)}`, { cause: error });
}
