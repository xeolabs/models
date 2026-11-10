import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { noLinks } from '../storage/paths.js';
import { fail } from '../domain/ModelsError.js';
import type { SketchfabCredential } from '../providers/SketchfabCredential.js';

export const sketchfabCredentialSchema = z
  .object({
    method: z.enum(['api-token', 'oauth']),
    token: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9._~+\/-]+=*$/),
  })
  .strict();
const savedSchema = z
  .object({
    version: z.literal(1),
    credential: sketchfabCredentialSchema,
    username: z.string().min(1).max(200),
    verifiedAt: z.string().datetime(),
  })
  .strict();
type SavedConfiguration = z.infer<typeof savedSchema>;

/**
 * The account belongs to this Models server. Its token lives in an owner-only
 * file outside the catalog and exports, and is loaded again when the server starts.
 */
export class SketchfabConfiguration {
  private readonly file: string;
  private value?: SavedConfiguration;

  constructor(root: string) {
    this.file = path.join(root, '.credentials', 'sketchfab.json');
    noLinks(this.file);
    if (!fs.existsSync(this.file)) return;
    const stat = fs.statSync(this.file);
    if (!stat.isFile() || stat.size > 16384 || (process.platform !== 'win32' && stat.mode & 0o077))
      fail(
        'INVALID_PROVIDER_CREDENTIALS',
        'Sketchfab configuration must be a private, owner-only file.',
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      fail('INVALID_PROVIDER_CREDENTIALS', 'Saved Sketchfab configuration is invalid.');
    }
    const result = savedSchema.safeParse(parsed);
    if (!result.success)
      fail('INVALID_PROVIDER_CREDENTIALS', 'Saved Sketchfab configuration is invalid.');
    this.value = result.data;
  }

  credential(): SketchfabCredential | undefined {
    return this.value ? { ...this.value.credential } : undefined;
  }

  status() {
    return this.value
      ? {
          configured: true,
          username: this.value.username,
          method: this.value.credential.method,
          verifiedAt: this.value.verifiedAt,
        }
      : { configured: false };
  }

  save(credential: SketchfabCredential, username: string): void {
    const value: SavedConfiguration = {
      version: 1,
      credential: { ...credential },
      username,
      verifiedAt: new Date().toISOString(),
    };
    noLinks(this.file);
    const directory = path.dirname(this.file);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stage = path.join(directory, '.sketchfab-' + randomUUID());
    try {
      const fd = fs.openSync(stage, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(stage, this.file);
      this.value = value;
    } finally {
      fs.rmSync(stage, { force: true });
    }
  }

  clear(): void {
    noLinks(this.file);
    fs.rmSync(this.file, { force: true });
    this.value = undefined;
  }
}
