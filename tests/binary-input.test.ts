import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { readBinaryInput } from '../tools/readBinaryInput.js';

test('binary input preserves data across chunk boundaries and handles short reads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-binary-input-'));
  try {
    const file = path.join(root, 'model.ifc');
    const bytes = Buffer.alloc(8 * 1024 ** 2 + 17, 0x41);
    bytes[8 * 1024 ** 2] = 0x42;
    bytes[bytes.length - 1] = 0x43;
    fs.writeFileSync(file, bytes);
    expect(Buffer.from(readBinaryInput(file)).equals(bytes)).toBe(true);
    const read = fs.readSync.bind(fs);
    const shortReads = vi
      .spyOn(fs, 'readSync')
      .mockImplementation((fd, buffer, offset, length, position) =>
        read(fd, buffer, offset, Math.min(length, 512 * 1024), position),
      );
    try {
      expect(Buffer.from(readBinaryInput(file)).equals(bytes)).toBe(true);
    } finally {
      shortReads.mockRestore();
    }
    const ended = vi.spyOn(fs, 'readSync').mockReturnValue(0);
    try {
      expect(() => readBinaryInput(file)).toThrow('ended before its recorded size');
    } finally {
      ended.mockRestore();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
