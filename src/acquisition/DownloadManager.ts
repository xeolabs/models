import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ProviderHttpClient } from '../providers/ProviderHttpClient.js';
import type { ProviderDownloadFile, ProviderId } from '../providers/types.js';
import { fail } from '../domain/ModelsError.js';
import { noLinks } from '../storage/paths.js';
export interface DownloadedFile {
  path: string;
  sha256: string;
  bytes: number;
}
export interface DownloadOptions {
  signal?: AbortSignal;
  maxBytes: number;
  onBytes: (bytes: number) => void | Promise<void>;
  remainingBytes: () => number | Promise<number>;
}

/**
 * Streams to a unique partial file. Only a fully verified file becomes a completed download.
 */
export class DownloadManager {
  constructor(
    private readonly http: ProviderHttpClient,
    private readonly resolve: (
      provider: ProviderId,
      file: ProviderDownloadFile,
      signal?: AbortSignal,
    ) => Promise<string> = async (_provider, file) => file.url,
  ) {}
  async download(
    provider: ProviderId,
    file: ProviderDownloadFile,
    directory: string,
    options: DownloadOptions,
  ): Promise<DownloadedFile> {
    noLinks(directory);
    fs.mkdirSync(directory, { recursive: true });
    return this.http.transfer(
      provider,
      await this.resolve(provider, file, options.signal),
      async (response) => {
        if (response.status !== 200)
          fail('DOWNLOAD_FAILED', 'Download: expected a complete response');
        const length = response.headers['content-length'];
        const declared = length === undefined ? undefined : Number(length);
        if (declared !== undefined && (!Number.isSafeInteger(declared) || declared < 0))
          fail('INVALID_PROVIDER_RESPONSE', 'Download: invalid content length');
        if ((declared ?? file.sizeBytes ?? 0) > options.maxBytes)
          fail('DOWNLOAD_TOO_LARGE', 'Download: response exceeds file size limit');
        if ((declared ?? file.sizeBytes ?? 0) > (await options.remainingBytes()))
          fail(
            'ACQUISITION_LIMIT_EXCEEDED',
            'Download: response exceeds remaining transfer budget',
          );
        if (
          response.headers['content-encoding'] &&
          response.headers['content-encoding'] !== 'identity'
        )
          fail('INVALID_PROVIDER_RESPONSE', 'Download: encoded transfer is not supported');
        const stage = path.join(directory, '.partial-' + randomUUID()),
          complete = path.join(directory, randomUUID() + '-' + file.filename);
        const handle = await fs.promises.open(stage, 'wx', 0o600);
        let bytes = 0;
        const sha = createHash('sha256'),
          expected = file.checksum ? createHash(file.checksum.algorithm) : undefined;
        try {
          for await (const chunk of response.body) {
            options.signal?.throwIfAborted();
            await options.onBytes(chunk.length);
            bytes += chunk.length;
            if (bytes > options.maxBytes)
              fail('DOWNLOAD_TOO_LARGE', 'Download: streamed file exceeds limit');
            sha.update(chunk);
            expected?.update(chunk);
            await handle.writeFile(chunk);
          }
          if (file.sizeBytes !== undefined && bytes !== file.sizeBytes)
            fail('PLAN_STALE', 'Download: byte length differs from the immutable plan');
          if (declared !== undefined && bytes !== declared)
            fail('DOWNLOAD_FAILED', 'Download: incomplete response');
          if (expected && expected.digest('hex') !== file.checksum!.value)
            fail('CHECKSUM_MISMATCH', 'Download: provider checksum did not match');
          await handle.sync();
          await handle.close();
          fs.renameSync(stage, complete);
          return { path: complete, bytes, sha256: sha.digest('hex') };
        } finally {
          await handle.close().catch(() => {});
          fs.rmSync(stage, { force: true });
        }
      },
      options.signal,
    );
  }
}
