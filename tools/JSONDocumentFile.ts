import fs from 'node:fs';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parser } from 'stream-json';
import { Assembler } from 'stream-json/assembler.js';
import { disassembler } from 'stream-json/disassembler.js';
import { stringer } from 'stream-json/stringer.js';

/**
 * SDK documents still become JavaScript objects, but their complete JSON text
 * never has to fit in one string. This is used for generated, cached model data.
 */
export class JSONDocumentFile {
  static async read(file: string): Promise<unknown> {
    const document = new Assembler();
    await pipeline(
      fs.createReadStream(file),
      parser.asStream({ streamValues: false }),
      new Writable({
        objectMode: true,
        write(token, _encoding, callback) {
          try {
            document.consume(token);
            callback();
          } catch (error) {
            callback(error as Error);
          }
        },
      }),
    );
    return document.current;
  }

  static async write(file: string, value: unknown, maxBytes: number): Promise<number> {
    if (['undefined', 'function', 'symbol'].includes(typeof value))
      throw new TypeError('A JSON document must have a serializable root value.');
    let bytes = 0;
    const tokens = disassembler({
      streamValues: false,
      replacer(_key, item) {
        if (typeof item === 'bigint') throw new TypeError('BigInt is not a JSON value.');
        return item;
      },
    })(value);
    await pipeline(
      Readable.from(tokens),
      stringer.asStream({ useValues: true }),
      new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > maxBytes)
            callback(new Error('Converted JSON exceeds the output byte limit.'));
          else callback(null, chunk);
        },
      }),
      fs.createWriteStream(file, { flags: 'wx', highWaterMark: 1024 ** 2 }),
    );
    return bytes;
  }
}
