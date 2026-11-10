import { request, readResponse } from './http';
import type {
  FederatedSearchResult,
  ProviderId,
  ProviderInfo,
  ProviderDownload,
} from '../../src/providers/types.js';
import type {
  AcquisitionCriteriaInput,
  AcquisitionPlan,
  AcquisitionJob,
  AcquisitionJobItem,
  Page,
} from '../../src/acquisition/types.js';
export type JobDetails = AcquisitionJob & { items: AcquisitionJobItem[] };

/**
 * The browser sends intentions; only the server talks to providers or writes the catalog.
 */
export class AcquisitionApi {
  private async post<T>(path: string, value: unknown): Promise<T> {
    return readResponse<T>(
      await fetch('/api/acquisition' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Models-Action': 'explicit' },
        body: JSON.stringify(value),
      }),
    );
  }
  providers() {
    return request<ProviderInfo[]>('/api/acquisition/providers');
  }
  search(text: string, providers: ProviderId[], signal?: AbortSignal) {
    const query = new URLSearchParams({ q: text, limit: '30' });
    providers.forEach((p) => query.append('provider', p));
    return request<FederatedSearchResult>('/api/acquisition/search?' + query, signal);
  }
  downloads(provider: ProviderId, remoteId: string, signal?: AbortSignal) {
    return request<ProviderDownload[]>(
      `/api/acquisition/models/${provider}/${encodeURIComponent(remoteId)}/downloads`,
      signal,
    );
  }
  plans() {
    return request<Page<AcquisitionPlan>>('/api/acquisition/plans');
  }
  jobs() {
    return request<Page<AcquisitionJob>>('/api/acquisition/jobs');
  }
  plan(id: string) {
    return request<AcquisitionPlan>('/api/acquisition/plans/' + id);
  }
  job(id: string) {
    return request<JobDetails>('/api/acquisition/jobs/' + id);
  }
  create(criteria: AcquisitionCriteriaInput) {
    return this.post<AcquisitionPlan>('/plans', criteria);
  }
  execute(id: string) {
    return this.post<AcquisitionJob>('/plans/' + id + '/execute', { confirmed: true });
  }
  resume(id: string) {
    return this.post<AcquisitionJob>('/jobs/' + id + '/resume', { confirmed: true });
  }
  cancel(id: string) {
    return this.post<{ requested: boolean }>('/jobs/' + id + '/cancel', {});
  }
}
