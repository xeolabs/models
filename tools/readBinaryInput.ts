import fs from 'node:fs';

/**
 * Binary SDK loaders need a complete ArrayBuffer. Read it in chunks because
 * Node's readFileSync rejects files above 2 GiB. Filling the final buffer also
 * avoids holding a second copy of a large IFC in memory.
 */
export function readBinaryInput(file: string): ArrayBuffer {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = new ArrayBuffer(size);
    let offset = 0;
    while (offset < size) {
      const chunk = new Uint8Array(buffer, offset, Math.min(8 * 1024 ** 2, size - offset));
      const count = fs.readSync(fd, chunk, 0, chunk.byteLength, offset);
      if (!count) throw new Error('Conversion input ended before its recorded size.');
      offset += count;
    }
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}
