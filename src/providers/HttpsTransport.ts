import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import { ModelsError } from '../domain/ModelsError.js';
import { resolvePublic } from './HostPolicy.js';
export interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Buffer>;
  close(): void;
}
export interface HttpRequestOptions {
  headers: Record<string, string>;
  signal?: AbortSignal;
  connectTimeoutMs: number;
  inactivityTimeoutMs: number;
  overallTimeoutMs: number;
}
export interface HttpTransport {
  request(url: URL, options: HttpRequestOptions): Promise<HttpResponse>;
}

/**
 * Pins the checked DNS address while retaining TLS certificate checks against the real host.
 */
export class HttpsTransport implements HttpTransport {
  async request(url: URL, options: HttpRequestOptions): Promise<HttpResponse> {
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const address = await Promise.race([
      resolvePublic(url.hostname),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(
          () =>
            reject(new ModelsError('DOWNLOAD_TIMEOUT', 'Provider request: DNS lookup timed out')),
          options.connectTimeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(dnsTimer));
    options.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const request = https.request(url, {
        method: 'GET',
        headers: options.headers,
        signal: options.signal,
        agent: false,
        family: address.family,
        lookup: (_host, _options, done) => done(null, address.address, address.family),
      });
      const timeout = (message: string) =>
        request.destroy(new ModelsError('DOWNLOAD_TIMEOUT', message));
      const establishment = setTimeout(
        () => timeout('Provider request: establishment timed out'),
        options.connectTimeoutMs,
      );
      const overall = setTimeout(
        () => timeout('Provider request: overall timeout'),
        options.overallTimeoutMs,
      );
      request.setTimeout(options.inactivityTimeoutMs, () =>
        timeout('Provider request: response stopped transferring'),
      );
      const clear = () => {
        clearTimeout(establishment);
        clearTimeout(overall);
      };
      request.on('error', (error) => {
        clear();
        reject(error);
      });
      request.on('response', (response) => {
        clearTimeout(establishment);
        response.on('close', clear);
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          close: () => {
            response.destroy();
            request.destroy();
            clear();
          },
        });
      });
      request.end();
    });
  }
}
