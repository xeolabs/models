import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { JSONDocumentFile } from '../tools/JSONDocumentFile.js';

test('streamed SDK JSON preserves native JSON semantics, Unicode and property names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-json-'));
  try {
    const file = path.join(root, 'model.json');
    const value = {
      version: '1.0',
      omitted: undefined,
      objects: [
        {
          id: 'building',
          name: 'Bakı 🏟️ "\\\n',
          values: [null, true, 0, -2.5, 1e50, undefined, NaN],
        },
      ],
      propertySets: [JSON.parse('{"__proto__":{"label":"preserved"},"constructor":"value"}')],
    };
    for (const [index, primitive] of [null, true, 0, 'text'].entries()) {
      const primitiveFile = path.join(root, `primitive-${index}.json`);
      await JSONDocumentFile.write(primitiveFile, primitive, 100);
      expect(await JSONDocumentFile.read(primitiveFile)).toBe(primitive);
    }
    await expect(
      JSONDocumentFile.write(path.join(root, 'bigint.json'), { value: 1n }, 100),
    ).rejects.toThrow('BigInt');
    const expected = JSON.stringify(value);
    expect(await JSONDocumentFile.write(file, value, 1024 ** 2)).toBe(Buffer.byteLength(expected));
    expect(fs.readFileSync(file, 'utf8')).toBe(expected);
    expect(await JSONDocumentFile.read(file)).toEqual(JSON.parse(expected));
    await expect(JSONDocumentFile.write(file, value, 1024 ** 2)).rejects.toBeDefined();
    expect(fs.readFileSync(file, 'utf8')).toBe(expected);
    await expect(
      JSONDocumentFile.write(path.join(root, 'limited.json'), value, 10),
    ).rejects.toThrow('byte limit');
    for (const invalid of ['', '{"a":[1,', '{"a":1} trailing', '{"a":1}{"b":2}']) {
      fs.writeFileSync(path.join(root, 'invalid.json'), invalid);
      await expect(JSONDocumentFile.read(path.join(root, 'invalid.json'))).rejects.toBeDefined();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.runIf(process.env.MODELS_LARGE_JSON_TESTS === '1')(
  'round-trips generated JSON beyond the JavaScript single-string limit',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-large-json-'));
    try {
      const file = path.join(root, 'model.datamodel.json');
      const text = 'x'.repeat(1024 ** 2);
      const value = {
        version: '1.0',
        propertySets: Array.from({ length: 520 }, (_, id) => ({ id, text })),
      };
      expect(() => JSON.stringify(value)).toThrow('Invalid string length');
      expect(await JSONDocumentFile.write(file, value, 1024 ** 3)).toBeGreaterThan(512 * 1024 ** 2);
      const restored = (await JSONDocumentFile.read(file)) as typeof value;
      expect(restored.version).toBe('1.0');
      expect(restored.propertySets).toHaveLength(520);
      for (let i = 0; i < restored.propertySets.length; i++) {
        expect(restored.propertySets[i].id).toBe(i);
        expect(restored.propertySets[i].text === text).toBe(true);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  180000,
);
