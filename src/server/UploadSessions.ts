import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { relativeFile } from '../storage/paths.js';
import { fail, ModelsError } from '../domain/ModelsError.js';
import { ModelsLibrary } from '../ModelsLibrary.js';

/**
 * Browser uploads are staged in private directories. Only a complete, validated
 * package can enter the catalog. Abandoned sessions expire after fifteen minutes.
 */
export class UploadSessions {
  private readonly sessions = new Map<
    string,
    { root: string; bytes: number; files: number; expires: number; busy: boolean }
  >();
  private readonly timer: ReturnType<typeof setInterval>;
  constructor() {
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref();
  }
  private sweep() {
    for (const [id, s] of this.sessions) if (!s.busy && s.expires < Date.now()) this.remove(id);
  }
  create() {
    this.sweep();
    if (this.sessions.size >= 8) fail('CONFLICT', 'Too many upload sessions');
    const id = randomUUID();
    this.sessions.set(id, {
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'models-upload-')),
      bytes: 0,
      files: 0,
      expires: Date.now() + 900000,
      busy: false,
    });
    return { id };
  }
  private require(id: string) {
    const s = this.sessions.get(id);
    if (!s) fail('ASSET_NOT_FOUND', 'Upload session has expired');
    if (s.busy) fail('CONFLICT', 'Upload session is busy');
    return s;
  }
  async file(id: string, name: string, request: IncomingMessage) {
    const s = this.require(id);
    s.busy = true;
    let count = 0;
    try {
      if (s.files >= 64) fail('INVALID_BUNDLE', 'Upload: at most 64 files');
      const destination = relativeFile(s.root, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      await pipeline(
        request,
        new Transform({
          transform(chunk: Buffer, _e, cb) {
            count += chunk.length;
            s.bytes += chunk.length;
            if (count > 256 * 1024 ** 2 || s.bytes > 512 * 1024 ** 2)
              cb(new ModelsError('INVALID_BUNDLE', 'Upload exceeds package limits'));
            else cb(null, chunk);
          },
        }),
        fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      );
      s.files++;
      s.expires = Date.now() + 900000;
      return { bytes: count };
    } catch (e) {
      s.busy = false;
      this.remove(id);
      throw e;
    } finally {
      s.busy = false;
    }
  }
  async commit(
    id: string,
    input: {
      entrypoint: string;
      name?: string;
      tags?: string[];
      propertySetMode?: import('../properties/types.js').PropertySetMode;
    },
    library: ModelsLibrary,
  ) {
    const s = this.require(id);
    s.busy = true;
    try {
      const file = relativeFile(s.root, input.entrypoint);
      if (input.entrypoint.toLowerCase().endsWith('.zip'))
        return await library.importBundle({ path: file });
      return await library.importFile({
        path: file,
        name: input.name,
        tags: input.tags,
        propertySetMode: input.propertySetMode,
      });
    } finally {
      s.busy = false;
      this.remove(id);
    }
  }
  remove(id: string) {
    const s = this.sessions.get(id);
    if (s?.busy) fail('CONFLICT', 'Upload is in progress');
    if (s) fs.rmSync(s.root, { recursive: true, force: true });
    this.sessions.delete(id);
  }
  close() {
    clearInterval(this.timer);
    for (const id of this.sessions.keys()) this.remove(id);
  }
}
