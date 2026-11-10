import { providerIds } from './ProviderInfo.js';
import { z } from 'zod';
import { ProviderRegistry } from './ProviderRegistry.js';
import { response } from './validation.js';
import type { FederatedSearchQuery, FederatedSearchResult } from './types.js';

/**
 * Discovery is bounded and never changes the local model catalog.
 */
export class FederatedSearchService {
  constructor(private readonly providers: ProviderRegistry) {}
  async search(input: FederatedSearchQuery = {}): Promise<FederatedSearchResult> {
    const q = response(
      z
        .object({
          providers: z.array(z.enum(providerIds)).min(1).max(providerIds.length).optional(),
          text: z.string().optional(),
          tags: z.array(z.string()).optional(),
          categories: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(500).default(20),
        })
        .strict(),
      input,
    );
    const providers = [...new Set(q.providers ?? this.providers.list().map((p) => p.id))].sort();
    const result: FederatedSearchResult = { items: [], providerErrors: [] };
    const outcomes = await Promise.allSettled(
      providers.map((id) =>
        this.providers
          .get(id)
          .search({ text: q.text, tags: q.tags, categories: q.categories, limit: q.limit }),
      ),
    );
    outcomes.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') result.items.push(...outcome.value.items);
      else
        result.providerErrors.push({
          provider: providers[i],
          message:
            outcome.reason instanceof Error ? outcome.reason.message : 'Provider search failed',
        });
    });
    const unique = [
      ...new Map(result.items.map((m) => [m.provider + ':' + m.remoteId, m])).values(),
    ];
    const pages = providers.map((id) =>
      unique.filter((m) => m.provider === id).sort((a, b) => a.remoteId.localeCompare(b.remoteId)),
    );
    result.items = [];
    // Alternate providers so a full first catalog cannot hide every other provider.
    for (let i = 0; result.items.length < q.limit && pages.some((page) => i < page.length); i++)
      for (const page of pages)
        if (page[i] && result.items.length < q.limit) result.items.push(page[i]);
    return result;
  }
}
