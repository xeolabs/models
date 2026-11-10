import { z } from 'zod';
import { fail } from './ModelsError.js';
export const formats = [
  'gltf',
  'glb',
  'ifc',
  'obj',
  'stl',
  'ply',
  'las',
  'laz',
  'e57',
  'fbx',
  'blend',
  'step',
  'dxf',
  'dae',
  'cityjson',
  '3dtiles',
  'xkt',
  'xgf',
  'rvt',
  'nwd',
] as const;
export const sourceSchema = z
  .object({
    provider: z.string().max(200).optional(),
    url: z
      .string()
      .url()
      .refine(
        (value) => ['http:', 'https:'].includes(new URL(value).protocol),
        'Source URL must use HTTP or HTTPS',
      )
      .optional(),
    license: z.string().max(500).optional(),
    attribution: z.string().max(10000).optional(),
    remoteId: z.string().max(200).optional(),
    resolution: z.string().max(100).optional(),
    originalId: z.string().optional(),
  })
  .strict();
export const tagsSchema = z
  .array(z.string().trim().min(1).max(128))
  .max(100)
  .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()))].sort());
export const metadataSchema = z
  .object({
    name: z.string().trim().min(1).max(512),
    description: z.string().max(20000).default(''),
    tags: tagsSchema.default([]),
    source: sourceSchema.default({}),
  })
  .strict();
export const querySchema = z
  .object({
    text: z.string().max(1000).optional(),
    tags: tagsSchema.optional(),
    provider: z.string().optional(),
    format: z.enum(formats).optional(),
    formats: z.array(z.enum(formats)).min(1).max(40).optional(),
    limit: z.number().int().min(1).max(1000).default(50),
    offset: z.number().int().min(0).default(0),
    sort: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
    direction: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    metadata: metadataSchema,
    entrypoint: z.string().min(1),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4096),
    originalId: z.string().optional(),
  })
  .strict();
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(
      'INVALID_MODEL',
      result.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
    );
  return result.data;
}
export const encode = (value: unknown) => JSON.stringify(value);
export const decode = (value: string) => JSON.parse(value);
