import { z } from 'zod';
import { fail } from '../domain/ModelsError.js';
import { providerValidationMessage } from './providerValidationMessage.js';
export function response<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  context = 'Provider response',
): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    fail(
      'INVALID_PROVIDER_RESPONSE',
      `${context}: ${providerValidationMessage(parsed.error.issues)}`,
    );
  return parsed.data;
}
export const remoteIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/);
export const searchSchema = z
  .object({
    text: z.string().max(1000).optional(),
    tags: z.array(z.string().max(128)).max(100).optional(),
    categories: z.array(z.string().max(128)).max(100).optional(),
    limit: z.number().int().min(1).max(500).default(20),
    cursor: z
      .string()
      .regex(/^\d{1,7}$/)
      .optional(),
  })
  .strict();
export const cc0 = {
  id: 'CC0-1.0',
  name: 'Creative Commons CC0 1.0 Universal',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attributionRequired: false,
} as const;
export const ccBy = {
  id: 'CC-BY-4.0',
  name: 'Creative Commons Attribution 4.0 International',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  attributionRequired: true,
} as const;
export const freeLicenseSchema = z.union([
  z
    .object({
      id: z.literal(cc0.id),
      name: z.string().min(1),
      url: z.enum([cc0.url, cc0.url.slice(0, -1)]).optional(),
      attributionRequired: z.literal(false),
    })
    .strict(),
  z
    .object({
      id: z.literal(ccBy.id),
      name: z.string().min(1),
      url: z.literal(ccBy.url),
      attributionRequired: z.literal(true),
    })
    .strict(),
]);
export function freeLicense(value: unknown) {
  const result = freeLicenseSchema.safeParse(value);
  if (!result.success)
    fail(
      'UNSUPPORTED_LICENSE',
      'Acquisition: license must explicitly declare supported CC0 or CC BY 4.0 terms',
    );
  return result.data;
}
