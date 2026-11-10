import { request, readResponse } from './http';
export interface SketchfabAccountStatus {
  configured: boolean;
  username?: string;
  method?: 'api-token' | 'oauth';
  verifiedAt?: string;
}

/**
 * The browser can replace or remove a saved credential, but cannot read it back.
 */
export class SketchfabAccountApi {
  status(signal?: AbortSignal) {
    return request<SketchfabAccountStatus>('/api/acquisition/sketchfab/auth', signal);
  }
  private async post(route: string, value = {}) {
    return readResponse<SketchfabAccountStatus>(
      await fetch('/api/acquisition/sketchfab/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Models-Action': 'explicit' },
        body: JSON.stringify(value),
      }),
    );
  }
  connect(method: 'api-token' | 'oauth', token: string) {
    return this.post('auth', { method, token });
  }
  verify() {
    return this.post('verify');
  }
  disconnect() {
    return this.post('disconnect');
  }
}
