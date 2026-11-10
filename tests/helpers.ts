import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
export const gltf = Buffer.from(
  JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] }),
);
export const png = Buffer.from('89504e470d0a1a0a', 'hex');
export async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'models-test-')),
    directory = path.join(root, 'library'),
    source = path.join(root, 'source');
  fs.mkdirSync(source);
  const library = await ModelsLibrary.open({ root: directory, create: true });
  return {
    root,
    directory,
    source,
    library,
    async close() {
      await library.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
