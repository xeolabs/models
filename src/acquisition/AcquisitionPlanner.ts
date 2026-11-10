import { providerInfo } from '../providers/ProviderInfo.js';
import { randomUUID } from 'node:crypto';
import { compareResolutions } from '../domain/resolutions.js';
import { fail, ModelsError } from '../domain/ModelsError.js';
import { ProviderRegistry } from '../providers/ProviderRegistry.js';
import { freeLicense } from '../providers/validation.js';
import { AcquisitionPlanRepository } from './AcquisitionPlanRepository.js';
import { criteriaSchema, fingerprint, planSummary } from './planSchema.js';
import { ProviderModelMapper } from './ProviderModelMapper.js';
import type {
  AcquisitionCriteriaInput,
  AcquisitionCriteria,
  AcquisitionPlanItem,
  AcquisitionPlan,
  AcquisitionWarning,
} from './types.js';
import type { ProviderId, ProviderModel, ProviderDownload } from '../providers/types.js';

/**
 * Resolves bounded discovery into exact file selections. No binary URL is requested here.
 */
export class AcquisitionPlanner {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly plans: AcquisitionPlanRepository,
  ) {}
  private withinPackageLimit(downloads: ProviderDownload[], maximum?: number) {
    return maximum === undefined
      ? downloads
      : downloads.filter(
          (download) =>
            download.files.every((file) => file.sizeBytes !== undefined) &&
            download.files.reduce((n, file) => n + file.sizeBytes!, 0) <= maximum,
        );
  }
  async resolve(
    provider: ProviderId,
    remoteId: string,
    criteria: AcquisitionCriteria,
    ordinal: number,
  ): Promise<AcquisitionPlanItem> {
    const adapter = this.providers.get(provider),
      model = await adapter.getModel(remoteId);
    try {
      freeLicense(model.license);
    } catch {
      fail(
        'UNSUPPORTED_LICENSE',
        'Plan model: only explicitly declared CC0 or CC BY 4.0 assets are supported',
      );
    }
    return this.select(
      model,
      this.withinPackageLimit(await adapter.getDownloads(remoteId), criteria.maxPackageBytes),
      criteria.resolution!,
      criteria.format,
      ordinal,
    );
  }

  /**
   * Choose one format for one provider size. Execution uses this same selection rule.
   */
  private select(
    model: ProviderModel,
    downloads: ProviderDownload[],
    resolution: string,
    format: string | undefined,
    ordinal: number,
  ): AcquisitionPlanItem {
    const { provider, remoteId } = model;
    const download = downloads
      .filter((d) => d.resolution === resolution && (!format || d.format === format))
      .sort(
        (a, b) =>
          ['gltf', 'glb', 'fbx', 'blend', 'ifc'].indexOf(a.format) -
            ['gltf', 'glb', 'fbx', 'blend', 'ifc'].indexOf(b.format) || a.id.localeCompare(b.id),
      )[0];
    if (!download)
      fail(
        'DOWNLOAD_OPTION_NOT_FOUND',
        `Plan model: ${provider}/${remoteId} has no ${resolution} download in the requested format`,
      );
    const { files, warnings } = new ProviderModelMapper().select(model, download);
    // A plan records its selected files, not the search card's list of alternatives.
    const { downloadOptions: _alternatives, ...snapshot } = model;
    return {
      id: randomUUID(),
      ordinal,
      provider,
      remoteId,
      modelName: model.name,
      sourceUrl: model.sourceUrl,
      resolution: download.resolution,
      format: download.format,
      downloadId: download.id,
      files,
      expectedLicense: model.license,
      existingModelId: this.plans.existing(
        provider,
        remoteId,
        download.resolution,
        download.format,
      ),
      warnings,
      model: snapshot,
    };
  }
  private async resolveSizes(
    provider: ProviderId,
    remoteId: string,
    criteria: AcquisitionCriteria,
    warnings: AcquisitionWarning[],
  ): Promise<AcquisitionPlanItem[]> {
    if (criteria.resolution !== undefined)
      return [await this.resolve(provider, remoteId, criteria, 0)];
    const adapter = this.providers.get(provider);
    const model = await adapter.getModel(remoteId);
    try {
      freeLicense(model.license);
    } catch {
      fail(
        'UNSUPPORTED_LICENSE',
        'Plan model: only explicitly declared CC0 or CC BY 4.0 assets are supported',
      );
    }
    const downloads = this.withinPackageLimit(
      await adapter.getDownloads(remoteId),
      criteria.maxPackageBytes,
    );
    const sizes =
      criteria.resolutions === 'all'
        ? [...new Set(downloads.map((d) => d.resolution))].sort(compareResolutions)
        : criteria.resolutions!;
    if (!sizes.length && criteria.maxPackageBytes !== undefined) {
      warnings.push({
        code: 'MODEL_FILTERED',
        message: `${model.name}: no packages fit the selected download limit`,
      });
      return [];
    }
    if (!sizes.length)
      fail(
        'DOWNLOAD_OPTION_NOT_FOUND',
        `Plan model: ${provider}/${remoteId} has no supported downloads`,
      );
    const items: AcquisitionPlanItem[] = [];
    for (const size of sizes) {
      if (
        !downloads.some(
          (d) => d.resolution === size && (!criteria.format || d.format === criteria.format),
        )
      ) {
        warnings.push({
          code: 'DOWNLOAD_OPTION_NOT_FOUND',
          message: `${provider}/${remoteId}: ${size.toUpperCase()} is unavailable in the requested format; this size was not selected`,
        });
        continue;
      }
      try {
        items.push(this.select(model, downloads, size, criteria.format, 0));
      } catch (error) {
        if (
          !(error instanceof ModelsError) ||
          !['DOWNLOAD_TOO_LARGE', 'UNSUPPORTED_MODEL_MAPPING'].includes(error.code)
        )
          throw error;
        warnings.push({
          code: error.code,
          message: `${provider}/${remoteId} ${size.toUpperCase()}: not selected. ${error.message}`,
        });
      }
    }
    return items;
  }

  async create(input: AcquisitionCriteriaInput): Promise<AcquisitionPlan> {
    const parsed = criteriaSchema.safeParse(input);
    if (!parsed.success) fail('INVALID_PLAN', 'Create plan: invalid acquisition criteria');
    const criteria = parsed.data;
    for (const id of criteria.providers)
      if ((this.providers.get(id).getInfo?.() ?? providerInfo[id]).acquisition !== 'direct')
        fail('DOWNLOAD_OPTION_NOT_FOUND', providerInfo[id].name + ': ' + providerInfo[id].notice);
    criteria.providers = [...new Set(criteria.providers)].sort();
    criteria.tags = criteria.tags
      ? [...new Set(criteria.tags.map((t) => t.toLowerCase()))].sort()
      : undefined;
    const warnings: AcquisitionWarning[] = [],
      candidates: { provider: ProviderId; remoteId: string }[] = [],
      seen = new Set<string>();
    const add = (provider: ProviderId, remoteId: string) => {
      const key = provider + ':' + remoteId;
      if (seen.has(key)) return false;
      seen.add(key);
      candidates.push({ provider, remoteId });
      return true;
    };
    if (criteria.assets) {
      for (const a of criteria.assets) {
        if (!criteria.providers.includes(a.provider))
          fail('INVALID_PLAN', 'Create plan: selection uses an excluded provider');
        add(a.provider, a.remoteId);
      }
    } else
      for (const selection of criteria.selections ?? [
        { query: criteria.query ?? '', maxModels: criteria.maxModels },
      ]) {
        let selected = 0;
        const cursors = new Map<ProviderId, string | undefined>(
          criteria.providers.map((provider) => [provider, undefined]),
        );
        const visited = new Map<ProviderId, Set<string>>();
        for (
          let page = 0;
          page < 20 &&
          cursors.size &&
          selected < selection.maxModels &&
          candidates.length < criteria.maxModels;
          page++
        ) {
          const pages = await Promise.all(
            [...cursors].map(async ([provider, cursor]) => ({
              provider,
              result: await this.providers.get(provider).search({
                text: selection.query,
                tags: criteria.tags,
                categories: criteria.categories,
                limit: Math.min(50, selection.maxModels - selected),
                cursor,
              }),
            })),
          );
          // Alternate providers so the first catalog cannot consume every selection slot.
          const rows = pages.map((p) =>
            p.result.items.sort((a, b) => a.remoteId.localeCompare(b.remoteId)),
          );
          for (let index = 0; index < Math.max(0, ...rows.map((row) => row.length)); index++) {
            for (let source = 0; source < pages.length; source++) {
              if (selected >= selection.maxModels || candidates.length >= criteria.maxModels) break;
              const item = rows[source][index];
              if (item && add(pages[source].provider, item.remoteId)) selected++;
            }
          }
          for (const { provider, result } of pages) {
            const seenCursors = visited.get(provider) ?? new Set<string>();
            if (!result.nextCursor || seenCursors.has(result.nextCursor)) cursors.delete(provider);
            else {
              seenCursors.add(result.nextCursor);
              visited.set(provider, seenCursors);
              cursors.set(provider, result.nextCursor);
            }
          }
        }
      }
    if (candidates.length > criteria.maxModels)
      fail('ACQUISITION_LIMIT_EXCEEDED', 'Create plan: explicit selection exceeds model limit');
    const items: AcquisitionPlanItem[] = [];
    let reserved = 0;
    for (const candidate of candidates) {
      const resolved = await this.resolveSizes(
        candidate.provider,
        candidate.remoteId,
        criteria,
        warnings,
      );
      for (const item of resolved) {
        if (
          criteria.maxPolygons !== undefined &&
          (item.model.statistics?.polygonCount === undefined ||
            item.model.statistics.polygonCount > criteria.maxPolygons)
        ) {
          warnings.push({
            code: 'MODEL_FILTERED',
            message: `${item.modelName}: polygon count is unknown or exceeds the selected limit`,
          });
          continue;
        }
        if (
          criteria.maxPackageBytes !== undefined &&
          (item.files.some((file) => file.sizeBytes === undefined) ||
            item.files.reduce((n, file) => n + file.sizeBytes!, 0) > criteria.maxPackageBytes)
        ) {
          warnings.push({
            code: 'MODEL_FILTERED',
            message: `${item.modelName} ${item.resolution}: package size is unknown or exceeds the selected limit`,
          });
          continue;
        }

        if (items.length >= 500)
          fail(
            'ACQUISITION_LIMIT_EXCEEDED',
            'Create plan: more than 500 resolution sets; select fewer models or sizes',
          );
        if (item.files.some((f) => f.sizeBytes === undefined) && !criteria.allowUnknownSizes)
          fail(
            'ACQUISITION_LIMIT_EXCEEDED',
            'Create plan: unknown file size needs allowUnknownSizes',
          );
        const bytes = item.files.reduce(
          (n, f) => n + (f.sizeBytes ?? criteria.unknownSizeReservationBytes),
          0,
        );
        if (reserved + bytes > criteria.maxTotalBytes) {
          warnings.push({
            code: 'ACQUISITION_LIMIT_EXCEEDED',
            message: `${item.provider}/${item.remoteId} ${item.resolution.toUpperCase()}: omitted because the selected files exceed the remaining budget`,
          });
          continue;
        }
        reserved += bytes;
        item.ordinal = items.length;
        items.push(item);
      }
    }
    const createdAt = new Date().toISOString();
    const plan: AcquisitionPlan = {
      id: randomUUID(),
      schemaVersion: 1,
      createdAt,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      criteria,
      items,
      summary: planSummary(items),
      warnings,
      fingerprint: '',
    };
    plan.fingerprint = fingerprint(plan);
    return this.plans.save(plan);
  }
}
