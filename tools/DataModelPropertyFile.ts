import { CONVERSION_LIMITS } from '../src/conversion/limits.js';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { disassembler } from 'stream-json/disassembler.js';
import { Readable, Transform, compose } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parser } from 'stream-json';
import { Assembler } from 'stream-json/assembler.js';
import { stringer } from 'stream-json/stringer.js';
import { PropertyDatabaseWriter } from '../src/properties/PropertyDatabaseWriter.js';

/**
 * Moves a cached document's values into SQLite one set at a time. The remaining
 * JSON is copied as tokens, so even a very large model never becomes one string
 * or one JavaScript object. Its geometry does not need to be parsed again.
 */
export class DataModelPropertyFile {
  private static async write(tokens: AsyncIterable<unknown>, output: string): Promise<void> {
    let bytes = 0;
    await pipeline(
      Readable.from(tokens),
      stringer.asStream({ useValues: true }),
      new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          if (bytes > CONVERSION_LIMITS.bytes) done(new Error('DataModel export exceeds 3 GiB.'));
          else done(null, chunk);
        },
      }),
      fs.createWriteStream(output, { flags: 'wx' }),
    );
  }
  static async embed(input: string, output: string, databaseFile: string): Promise<void> {
    const db = new DatabaseSync(databaseFile, { readOnly: true });
    async function* tokens() {
      const source = compose(fs.createReadStream(input), parser.asStream({ streamValues: false }));
      let depth = 0,
        key = '';
      let skip = false;
      try {
        for await (const token of source) {
          if (token.name === 'keyValue' && depth === 1) {
            key = token.value;
            skip = key === 'propertySetMode' || key === 'propertySets';
          }
          if (!skip) yield token;
          if (token.name === 'startObject' || token.name === 'startArray') depth++;
          if (token.name === 'endObject' || token.name === 'endArray') depth--;
          if (depth === 1 && token.name === 'startObject') {
            yield { name: 'keyValue', value: 'propertySetMode' };
            yield { name: 'stringValue', value: 'embedded' };
            yield { name: 'keyValue', value: 'propertySets' };
            yield { name: 'startArray' };
            for (const row of db.prepare('SELECT json FROM property_sets ORDER BY id').iterate()) {
              yield* disassembler({ streamValues: false })(JSON.parse(row.json as string));
            }
            yield { name: 'endArray' };
          }
          // The root closing brace is not part of the last field.
          if (depth === 0 && token.name === 'endObject' && skip) yield token;
        }
      } finally {
        source.destroy();
      }
    }
    try {
      await DataModelPropertyFile.write(tokens(), output);
    } finally {
      db.close();
    }
  }

  static async externalize(
    input: string,
    output: string,
    writer: PropertyDatabaseWriter,
    revision: string,
  ): Promise<void> {
    async function* tokens() {
      const source = compose(fs.createReadStream(input), parser.asStream({ streamValues: false }));
      let depth = 0;
      let key = '';
      let capture: Assembler | undefined;
      let capturedDepth = 0;
      let skipField = false;
      try {
        for await (const token of source) {
          if (token.name === 'keyValue' && depth === 1) {
            key = token.value;
            skipField = key === 'propertySetMode' || key === 'revisionId';
          }
          const opening = token.name === 'startObject' || token.name === 'startArray';
          const closing = token.name === 'endObject' || token.name === 'endArray';
          if (
            depth === 2 &&
            token.name === 'startObject' &&
            (key === 'objects' || key === 'propertySets')
          ) {
            capture = new Assembler();
            capturedDepth = depth;
          }
          if (capture) capture.consume(token);
          const omit =
            skipField ||
            (key === 'propertySets' && depth >= 2 && !(depth === 2 && token.name === 'endArray'));
          if (!omit) yield token;
          if (opening) depth++;
          if (closing) depth--;
          if (depth === 1 && token.name === 'startObject') {
            yield { name: 'keyValue', value: 'propertySetMode' };
            yield { name: 'stringValue', value: 'external' };
            yield { name: 'keyValue', value: 'revisionId' };
            yield { name: 'stringValue', value: revision };
          }
          if (depth === 0 && token.name === 'endObject' && skipField) yield token;
          if (capture && closing && depth === capturedDepth) {
            if (key === 'propertySets') writer.addSet(capture.current);
            else writer.addObject(capture.current.id, capture.current.propertySetIds ?? []);
            capture = undefined;
          }
        }
      } finally {
        source.destroy();
      }
    }
    await DataModelPropertyFile.write(tokens(), output);
  }
}
