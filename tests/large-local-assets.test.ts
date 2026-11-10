import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { inspect } from '../src/storage/AssetStore.js';
import { inspectConversionFile } from '../src/conversion/ConversionFiles.js';
import { stageConversion } from '../src/conversion/ConversionStaging.js';
import { fixture } from './helpers.js';

test('files above 2 GiB pass conversion size checks while package and local import limits stay separate', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.source, 'large.xgf');
    const size = 2 * 1024 ** 3 + 1;
    const fd = fs.openSync(file, 'w');
    try {
      // A sparse file exercises the real size boundary without filling the disk.
      fs.ftruncateSync(fd, size);
      fs.writeSync(fd, Buffer.from('last byte'), 0, 9, size - 9);
    } finally {
      fs.closeSync(fd);
    }
    const expected = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) expected.update(chunk);
    const digest = expected.digest('hex');
    expect(inspect(file)).toMatchObject({ bytes: size, id: digest });
    await expect(inspectConversionFile(file)).resolves.toEqual({ bytes: size, id: digest });
    fs.truncateSync(file, 3 * 1024 ** 3 + 1);
    await expect(inspectConversionFile(file)).rejects.toMatchObject({ code: 'FILE_IO_ERROR' });
    await expect(
      stageConversion(
        [
          { path: 'first.xgf', source: file, sha256: digest, bytes: 2 * 1024 ** 3 },
          { path: 'second.xgf', source: file, sha256: digest, bytes: 1024 ** 3 + 1 },
        ],
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'CONVERSION_FAILED' });
    fs.truncateSync(file, 4 * 1024 ** 3 + 1);
    expect(() => inspect(file)).toThrow('at most 4 GiB');
    expect(await f.library.list()).toEqual([]);
  } finally {
    await f.close();
  }
}, 30000);
