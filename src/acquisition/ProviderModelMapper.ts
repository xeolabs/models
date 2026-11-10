import { fail } from '../domain/ModelsError.js';
import type { ProviderDownload, ProviderModel } from '../providers/types.js';
import type { AcquisitionWarning } from './types.js';

/**
 * Keep the entry file and every declared dependency in one acquisition.
 */
export class ProviderModelMapper {
  select(_model: ProviderModel, download: ProviderDownload) {
    if (download.files.filter((f) => f.role === 'entrypoint').length !== 1)
      fail('UNSUPPORTED_MODEL_MAPPING', 'Plan model: expected one entry file');
    if (download.files.some((f) => !['entrypoint', 'resource'].includes(f.role)))
      fail('UNSUPPORTED_MODEL_MAPPING', 'Plan model: unknown file role');
    const warnings: AcquisitionWarning[] = [];
    for (const file of download.files) {
      if ((file.sizeBytes ?? 0) > 256 * 1024 ** 2)
        fail('DOWNLOAD_TOO_LARGE', 'Plan model: file exceeds 256 MiB');
      if (!file.checksum)
        warnings.push({
          code: 'NO_PROVIDER_CHECKSUM',
          message: file.filename + ': provider supplies no stable checksum',
        });
    }
    return { files: download.files, warnings };
  }
}
