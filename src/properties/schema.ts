import { z } from 'zod';
import { fail } from '../domain/ModelsError.js';

export const PROPERTY_LIMITS = Object.freeze({
  ids: 128,
  setBytes: 4 * 1024 ** 2,
  responseBytes: 8 * 1024 ** 2,
  references: 2048,
});
export const propertyIdSchema = z.string().min(1).max(2048);
export const propertyModeSchema = z.enum(['embedded', 'external']);
export const propertyRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const propertySetSchema = z
  .object({
    id: propertyIdSchema,
    originalSystemId: z.string().optional(),
    name: z.string(),
    type: z.string(),
    schema: z.string().optional(),
    properties: z.array(
      z
        .object({
          name: z.string(),
          value: z.unknown(),
          type: z.string().optional(),
          valueType: z.union([z.string(), z.number()]).optional(),
          description: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const ids = z.array(propertyIdSchema).min(1).max(PROPERTY_LIMITS.ids);
export const propertySetQuerySchema = z
  .object({
    ids,
    revision: propertyRevisionSchema,
    cursor: z.number().int().nonnegative().optional(),
  })
  .strict();
export const objectPropertiesQuerySchema = z
  .object({
    objectIds: ids,
    revision: propertyRevisionSchema,
    cursor: z.string().max(256).optional(),
  })
  .strict();
export const propertyObjectQuerySchema = z
  .object({
    revision: propertyRevisionSchema,
    propertyName: z.string().min(1).max(2048),
    value: z.union([z.string().max(8192), z.number().finite(), z.boolean(), z.null()]),
    propertySetName: z.string().max(2048).optional(),
    after: propertyIdSchema.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();
export function propertyInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) fail('INVALID_PROPERTY_QUERY', 'Properties: invalid input');
  return parsed.data;
}

export const propertySetPageSchema = z
  .object({
    revision: propertyRevisionSchema,
    propertySets: z.array(propertySetSchema).max(PROPERTY_LIMITS.ids),
    missingIds: z.array(propertyIdSchema).max(PROPERTY_LIMITS.ids),
    nextCursor: z.number().int().positive().max(PROPERTY_LIMITS.ids).optional(),
  })
  .strict();
