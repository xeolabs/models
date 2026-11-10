import { freeLicenseSchema } from '../providers/validation.js';
import { providerIds, acquisitionProviderIds } from '../providers/ProviderInfo.js';
import { z } from 'zod';
import { resolutionPattern, compareResolutions } from '../domain/resolutions.js';
import { createHash } from 'node:crypto';
import { fail } from '../domain/ModelsError.js';
import { providerUrl } from '../providers/HostPolicy.js';
import type { AcquisitionPlan, AcquisitionPlanItem } from './types.js';
const provider = z.enum(providerIds);
const id = z.string().regex(/^[A-Za-z0-9_ -]{1,150}$/);
const words = z.array(z.string().trim().min(1).max(128)).max(100);
const resolution = z
  .string()
  .trim()
  .regex(resolutionPattern)
  .transform((s) => s.toLowerCase());
const count = z.number().int().positive().max(500);
export const criteriaSchema = z
  .object({
    providers: z.array(provider).min(1).max(providerIds.length).default(acquisitionProviderIds),
    query: z.string().max(1000).optional(),
    tags: words.optional(),
    categories: words.optional(),
    selections: z
      .array(z.object({ query: z.string().min(1).max(1000), maxModels: count }).strict())
      .max(100)
      .optional(),
    assets: z
      .array(z.object({ provider, remoteId: id }).strict())
      .max(500)
      .optional(),
    resolution: resolution.optional(),
    resolutions: z
      .union([
        z.literal('all'),
        z
          .array(resolution)
          .min(1)
          .max(500)
          .transform((sizes) => [...new Set(sizes)].sort(compareResolutions)),
      ])
      .optional(),
    format: z.enum(['gltf', 'glb', 'fbx', 'blend', 'ifc']).optional(),
    maxModels: count.default(20),
    maxPackageBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxPolygons: z.number().int().nonnegative().optional(),
    maxTotalBytes: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .default(2 * 1024 ** 3),
    skipExisting: z.boolean().default(true),
    allowUnknownSizes: z.boolean().default(false),
    unknownSizeReservationBytes: z
      .number()
      .int()
      .positive()
      .max(512 * 1024 ** 2)
      .default(256 * 1024 ** 2),
  })
  .strict()
  .refine((c) => (c.resolution !== undefined) !== (c.resolutions !== undefined), {
    message: 'Use resolution or resolutions, but not both',
  });
const license = freeLicenseSchema;
const warning = z.object({ code: z.string(), message: z.string() }).strict();
export const fileSchema = z
  .object({
    role: z.string().min(1),
    url: z.string().url(),
    filename: z
      .string()
      .regex(/^[^/\\:\0<>|?*]+$/)
      .refine((s) => s !== '.' && s !== '..'),
    packagePath: z
      .string()
      .regex(/^[^\\:\0<>|?*]+$/)
      .refine((p) => !p.startsWith('/') && !p.split('/').some((s) => !s || s === '.' || s === '..'))
      .optional(),
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    checksum: z
      .object({
        algorithm: z.enum(['sha256', 'sha1', 'md5']),
        value: z.string().regex(/^[a-f0-9]+$/),
      })
      .strict()
      .superRefine((v, ctx) => {
        if (v.value.length !== { sha256: 64, sha1: 40, md5: 32 }[v.algorithm])
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid checksum length' });
      })
      .optional(),
  })
  .strict();
const model = z
  .object({
    provider,
    remoteId: id,
    name: z.string().min(1).max(512),
    description: z.string().optional(),
    tags: words,
    categories: words.optional(),
    sourceUrl: z.string().url(),
    previewUrl: z.string().url().optional(),
    license,
    availableResolutions: z.array(z.string()).optional(),
    statistics: z
      .object({
        polygonCount: z.number().int().nonnegative().optional(),
        vertexCount: z.number().int().nonnegative().optional(),
        maxTextureResolution: z.tuple([z.number().positive(), z.number().positive()]).optional(),
        hasLods: z.boolean().optional(),
        rigged: z.boolean().optional(),
      })
      .strict()
      .optional(),
    author: z.string().optional(),
    publishedAt: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export const itemSchema = z
  .object({
    id: z.string().uuid(),
    ordinal: z.number().int().nonnegative(),
    provider,
    remoteId: id,
    modelName: z.string().min(1),
    sourceUrl: z.string().url(),
    resolution,
    format: z.string(),
    downloadId: z.string().min(1),
    files: z.array(fileSchema).min(1).max(512),
    expectedLicense: license,
    existingModelId: z.string().uuid().optional(),
    warnings: z.array(warning),
    model,
  })
  .strict();
export const planSchema = z
  .object({
    id: z.string().uuid(),
    schemaVersion: z.literal(1),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    criteria: criteriaSchema,
    items: z.array(itemSchema).max(500),
    summary: z
      .object({
        selectedModels: z.number().int().nonnegative(),
        knownBytes: z.number().int().nonnegative(),
        unknownSizeFiles: z.number().int().nonnegative(),
        estimatedTotalBytes: z.number().int().nonnegative().optional(),
      })
      .strict(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    warnings: z.array(warning),
  })
  .strict();

/**
 * JSON with sorted object keys; array order remains part of the specification.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map((v) => canonical(v)).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function itemSpecification(item: AcquisitionPlanItem) {
  const { id: _id, existingModelId: _existing, ...spec } = item;
  return spec;
}
export function fingerprint(
  plan: Pick<AcquisitionPlan, 'criteria' | 'items' | 'summary' | 'warnings'>,
) {
  return digest({
    criteria: plan.criteria,
    items: plan.items.map(itemSpecification),
    summary: plan.summary,
    warnings: plan.warnings,
  });
}
export function planSummary(items: AcquisitionPlanItem[]) {
  const files = items.flatMap((i) => i.files);
  const unknownSizeFiles = files.filter((f) => f.sizeBytes === undefined).length;
  const knownBytes = files.reduce((s, f) => s + (f.sizeBytes ?? 0), 0);
  return {
    selectedModels: items.length,
    knownBytes,
    unknownSizeFiles,
    ...(!unknownSizeFiles ? { estimatedTotalBytes: knownBytes } : {}),
  };
}
export function validatePlan(value: unknown): AcquisitionPlan {
  const result = planSchema.safeParse(value);
  if (!result.success) fail('INVALID_PLAN', 'Acquisition plan: invalid versioned document');
  const p = result.data as AcquisitionPlan;
  if (
    new Set(p.items.map((item) => item.provider + ':' + item.remoteId)).size >
      p.criteria.maxModels ||
    p.summary.knownBytes > p.criteria.maxTotalBytes ||
    canonical(p.summary) !== canonical(planSummary(p.items)) ||
    p.fingerprint !== fingerprint(p)
  )
    fail('INVALID_PLAN', 'Acquisition plan: fingerprint, summary or limits do not match');
  if (p.expiresAt && p.expiresAt < p.createdAt)
    fail('INVALID_PLAN', 'Acquisition plan: expiry precedes creation');
  const seen = new Set<string>();
  let reservation = 0;
  for (const [ordinal, item] of p.items.entries()) {
    if (!acquisitionProviderIds.includes(item.provider))
      fail('INVALID_PLAN', 'Acquisition plan: provider supports website downloads only');
    const key = [item.provider, item.remoteId, item.resolution].join(':');
    if (
      seen.has(key) ||
      item.ordinal !== ordinal ||
      !p.criteria.providers.includes(item.provider) ||
      (p.criteria.resolution !== undefined && item.resolution !== p.criteria.resolution) ||
      (Array.isArray(p.criteria.resolutions) &&
        !p.criteria.resolutions.includes(item.resolution)) ||
      (p.criteria.format && item.format !== p.criteria.format) ||
      item.model.provider !== item.provider ||
      item.model.remoteId !== item.remoteId ||
      canonical(item.model.license) !== canonical(item.expectedLicense)
    )
      fail('INVALID_PLAN', 'Acquisition plan: inconsistent model selection');
    seen.add(key);
    if (
      p.criteria.maxPolygons !== undefined &&
      (item.model.statistics?.polygonCount === undefined ||
        item.model.statistics.polygonCount > p.criteria.maxPolygons)
    )
      fail('INVALID_PLAN', 'Acquisition plan: polygon limit does not match');
    if (
      p.criteria.maxPackageBytes !== undefined &&
      (item.files.some((file) => file.sizeBytes === undefined) ||
        item.files.reduce((n, file) => n + file.sizeBytes!, 0) > p.criteria.maxPackageBytes)
    )
      fail('INVALID_PLAN', 'Acquisition plan: package size limit does not match');
    for (const f of item.files) {
      providerUrl(item.provider, f.url);
      if (f.sizeBytes === undefined && !p.criteria.allowUnknownSizes)
        fail('INVALID_PLAN', 'Acquisition plan: unknown file size requires an explicit policy');
      reservation += f.sizeBytes ?? p.criteria.unknownSizeReservationBytes;
    }
  }
  if (reservation > p.criteria.maxTotalBytes)
    fail('INVALID_PLAN', 'Acquisition plan: reservations exceed budget');
  return p;
}
