import type { SketchfabCredentialSource } from './SketchfabCredential.js';
import { BuildingSmartProvider } from './BuildingSmartProvider.js';
import { BuildingSmartCommunityProvider } from './BuildingSmartCommunityProvider.js';
import { providerIds } from './ProviderInfo.js';
import { SketchfabProvider } from './SketchfabProvider.js';
import { SmithsonianProvider } from './SmithsonianProvider.js';
import { PolyHavenProvider } from './PolyHavenProvider.js';
import { ProviderHttpClient } from './ProviderHttpClient.js';
import { fail } from '../domain/ModelsError.js';
import type { ModelProvider, ProviderId } from './types.js';
export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, ModelProvider>();
  constructor(http = new ProviderHttpClient(), sketchfabCredential?: SketchfabCredentialSource) {
    this.register(new BuildingSmartProvider(http));
    this.register(new BuildingSmartCommunityProvider(http));
    this.register(new PolyHavenProvider(http));
    this.register(new SketchfabProvider(http, sketchfabCredential));
    this.register(new SmithsonianProvider(http));
  }
  get(id: ProviderId) {
    return this.providers.get(id) ?? fail('PROVIDER_NOT_FOUND', 'Unknown model provider');
  }
  list() {
    return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  register(provider: ModelProvider) {
    if (!providerIds.includes(provider.id))
      fail('PROVIDER_NOT_FOUND', 'Unsupported provider identifier');
    this.providers.set(provider.id, provider);
  }
}
