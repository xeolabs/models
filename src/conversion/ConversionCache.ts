import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fail } from '../domain/ModelsError.js';
import { inspectConversionFile, copyConversionFile } from './ConversionFiles.js';
import { noLinks, relativeFile } from '../storage/paths.js';
import { conversionFormats, type ConvertedModel } from './types.js';
import { CONVERSION_LIMITS } from './limits.js';

export const optionsSchema = z.object({
  formats: z.array(
    z.object({
      format: z.enum(conversionFormats),
      warnings: z.array(z.string()),
    }),
  ),
});
export const conversionResultSchema = z.object({
  propertyDatabase: z.literal('properties.db').optional(),
  thumbnail: z.literal('thumbnail.png').optional(),
  options: optionsSchema.optional(),
  entrypoint: z.string(),
  files: z.array(z.string()).min(1).max(CONVERSION_LIMITS.files),
  warnings: z.array(z.string()),
});
const cachedSchema = z.object({
  modelId: z.string().uuid(),
  format: z.enum(conversionFormats),
  entrypoint: z.string(),
  files: z
    .array(
      z.object({
        path: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(CONVERSION_LIMITS.files),
  warnings: z.array(z.string()),
  createdAt: z.string(),
  cached: z.boolean(),
});

/**
 * This directory is disposable. Original models and assets remain in the catalog.
 * A manifest appears only after all of a conversion's files are installed.
 */
export class ConversionCache {
  readonly root: string;
  constructor(libraryRoot: string) {
    this.root = path.join(libraryRoot, '.cache', 'conversions');
  }
  directory(id: string, fingerprint?: string, format?: string) {
    if (
      !z.string().uuid().safeParse(id).success ||
      (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) ||
      (format && !z.enum(conversionFormats).safeParse(format).success)
    )
      fail('PATH_OUTSIDE_ROOT', 'Conversion cache: invalid cache key');
    const result = path.join(
      this.root,
      id,
      ...(fingerprint ? [fingerprint] : []),
      ...(format ? [format] : []),
    );
    noLinks(result);
    return result;
  }
  readOptions(id: string, fingerprint: string) {
    return this.read(path.join(this.directory(id, fingerprint), 'options.json'), optionsSchema);
  }
  writeOptions(id: string, fingerprint: string, options: z.infer<typeof optionsSchema>) {
    const directory = this.directory(id, fingerprint);
    fs.mkdirSync(directory, { recursive: true });
    const temp = path.join(directory, '.options-' + randomUUID());
    fs.writeFileSync(temp, JSON.stringify(options), { flag: 'wx' });
    fs.renameSync(temp, path.join(directory, 'options.json'));
  }
  async get(id: string, fingerprint: string, format: string): Promise<ConvertedModel | null> {
    const directory = this.directory(id, fingerprint, format);
    const model = this.readModel(id, fingerprint, format);
    if (!model) return null;
    try {
      for (const file of model.files) {
        const actual = await inspectConversionFile(relativeFile(directory, file.path));
        if (actual.id !== file.sha256 || actual.bytes !== file.bytes) return null;
      }
      return { ...model, cached: true };
    } catch {
      return null;
    }
  }

  /**
   * A streaming request needs one chunk. Verify that file without reading every
   * other chunk again; full format requests still verify the complete package.
   */
  async getFile(id: string, fingerprint: string, format: string, name: string) {
    const model = this.readModel(id, fingerprint, format);
    if (!model) return null;
    const file = model.files.find((entry) => entry.path === name);
    if (!file)
      fail('ASSET_NOT_FOUND', 'Resolve model format: file does not belong to this representation');
    try {
      const local = relativeFile(this.directory(id, fingerprint, format), file.path);
      const actual = await inspectConversionFile(local);
      if (actual.id !== file.sha256 || actual.bytes !== file.bytes) return null;
      return { path: local, bytes: file.bytes, sha256: file.sha256 };
    } catch {
      return null;
    }
  }
  has(id: string, fingerprint: string, format: string) {
    return !!this.readModel(id, fingerprint, format);
  }
  private readModel(id: string, fingerprint: string, format: string) {
    const directory = this.directory(id, fingerprint, format);
    const model = this.read(path.join(directory, 'manifest.json'), cachedSchema);
    if (
      !model ||
      model.modelId !== id ||
      model.format !== format ||
      !model.files.some((file) => file.path === model.entrypoint)
    )
      return null;
    return model;
  }
  async prepareInstall(id: string, fingerprint: string, model: ConvertedModel, output: string) {
    const directory = this.directory(id, fingerprint, model.format);
    await fs.promises.mkdir(path.dirname(directory), { recursive: true });
    const temp = directory + '.partial-' + randomUUID();
    await fs.promises.mkdir(temp);
    try {
      for (const file of model.files)
        await copyConversionFile(relativeFile(output, file.path), relativeFile(temp, file.path));
      await fs.promises.writeFile(path.join(temp, 'manifest.json'), JSON.stringify(model));
      return {
        commit: () => {
          fs.rmSync(directory, { recursive: true, force: true });
          fs.renameSync(temp, directory);
        },
        cleanup: () => fs.promises.rm(temp, { recursive: true, force: true }),
      };
    } catch (error) {
      await fs.promises.rm(temp, { recursive: true, force: true });
      throw error;
    }
  }
  remove(id: string) {
    fs.rmSync(this.directory(id), { recursive: true, force: true });
  }
  private read<T extends z.ZodTypeAny>(file: string, schema: T): z.output<T> | null {
    noLinks(file);
    try {
      if (fs.statSync(file).size > 1024 * 1024) return null;
      const parsed = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
