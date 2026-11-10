import { propertyQueryRoute } from './propertyQueryRoute.js';
import os from 'node:os';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { fail } from '../domain/ModelsError.js';
import { modelFileRoute } from './modelFileRoute.js';
export interface ServerNetworkOptions {
  host?: string;
  allowedHosts?: string[];
  publicUrl?: string;
  allowedOrigins?: string[];
  pickerOrigins?: string[];
}

/**
 * The app and API share an origin. A LAN bind does not disable Host or Origin checks.
 */
export class ServerAccessPolicy {
  readonly host: string;
  private readonly publicOrigin?: string;
  constructor(private readonly options: ServerNetworkOptions) {
    this.host = options.host ?? '127.0.0.1';
    if (!isIP(this.host) && this.host !== 'localhost')
      fail('INVALID_MODEL', 'Serve browser: host must be an IP address or localhost');
    if (options.publicUrl) {
      let url: URL;
      try {
        url = new URL(options.publicUrl);
      } catch {
        return fail('INVALID_MODEL', 'Serve browser: invalid public URL');
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        fail('INVALID_MODEL', 'Serve browser: public URL must be an HTTP origin');
      this.publicOrigin = url.origin;
    }
    for (const origin of [...(options.allowedOrigins ?? []), ...(options.pickerOrigins ?? [])]) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        return fail('INVALID_MODEL', 'Serve browser: invalid allowed origin');
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
        fail(
          'INVALID_MODEL',
          'Serve browser: allowed origins must be exact HTTP origins without paths or wildcards',
        );
    }
    for (const host of options.allowedHosts ?? [])
      if (!/^[a-zA-Z0-9.:[\]-]+$/.test(host) || host.includes('*'))
        fail('INVALID_MODEL', 'Serve browser: invalid allowed host');
  }
  private hosts(port: number) {
    const names = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (this.host === '0.0.0.0' || this.host === '::') {
      names.add(os.hostname());
      for (const values of Object.values(os.networkInterfaces()))
        for (const address of values ?? [])
          names.add(address.family === 'IPv6' ? `[${address.address}]` : address.address);
    } else names.add(isIP(this.host) === 6 ? `[${this.host}]` : this.host);
    const authorities = new Set([...names].map((name) => `${name}:${port}`));
    for (const host of this.options.allowedHosts ?? []) authorities.add(host);
    if (this.publicOrigin) authorities.add(new URL(this.publicOrigin).host);
    return authorities;
  }
  accepts(request: IncomingMessage, port: number) {
    const host = request.headers.host;
    if (!host || !this.hosts(port).has(host) || request.headers['sec-fetch-site'] === 'cross-site')
      return false;
    const expected =
      this.publicOrigin && host === new URL(this.publicOrigin).host
        ? this.publicOrigin
        : `http://${host}`;
    return !request.headers.origin || request.headers.origin === expected;
  }

  /**
   * Trusted viewer apps may read catalog data and model files, but cannot run server actions.
   */
  catalogOrigin(request: IncomingMessage, port: number): string | undefined {
    const origin = request.headers.origin;
    if (
      !origin ||
      ![...(this.options.allowedOrigins ?? []), ...(this.options.pickerOrigins ?? [])].includes(
        origin,
      ) ||
      !this.hosts(port).has(request.headers.host ?? '')
    )
      return;
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (propertyQueryRoute.test(pathname)) {
      if (request.method === 'POST') return origin;
      const headers = String(request.headers['access-control-request-headers'] ?? '')
        .toLowerCase()
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        request.method === 'OPTIONS' &&
        request.headers['access-control-request-method'] === 'POST' &&
        headers.every((header) => header === 'content-type')
      )
        return origin;
      return;
    }
    if (request.method !== 'GET' && request.method !== 'OPTIONS') return;
    if (
      request.method === 'OPTIONS' &&
      (request.headers['access-control-request-method'] !== 'GET' ||
        request.headers['access-control-request-headers'])
    )
      return;
    if (/^\/api\/models\/[a-f0-9-]{36}\/(?:properties|datamodel)$/.test(pathname)) return origin;
    if (
      /^\/api\/(summary|formats|tags|models|picker)$/.test(pathname) ||
      /^\/api\/models\/[a-f0-9-]{36}(?:\/(?:thumbnail(?:\/status)?|files\/.+|bundle|formats(?:\/[a-z0-9]+(?:\/files\/.+)?)?|download-formats|conversions\/[a-z0-9]+\/download))?$/.test(
        pathname,
      ) ||
      /^\/api\/assets\/[a-f0-9]{64}$/.test(pathname)
    )
      return origin;
  }

  /**
   * Only the picker document may be opened from another site. Its frame policy
   * restricts embedding, while API writes still require the Models app's own origin.
   */
  pickerNavigation(request: IncomingMessage, port: number): boolean {
    return (
      request.method === 'GET' &&
      this.hosts(port).has(request.headers.host ?? '') &&
      new URL(request.url ?? '/', 'http://localhost').pathname === '/picker'
    );
  }

  /**
   * Anyone who knows a model file URL may read it. This exception grants no
   * access to listings, private cache files, conversions by POST or model edits.
   */
  modelFileRequest(request: IncomingMessage, port: number): boolean {
    if (
      !this.hosts(port).has(request.headers.host ?? '') ||
      !modelFileRoute(new URL(request.url ?? '/', 'http://localhost').pathname)
    )
      return false;
    if (request.method === 'GET' || request.method === 'HEAD') return true;
    const headers = String(request.headers['access-control-request-headers'] ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return (
      request.method === 'OPTIONS' &&
      ['GET', 'HEAD'].includes(String(request.headers['access-control-request-method'])) &&
      headers.every((header) => header === 'range')
    );
  }
  get pickerOrigins(): string[] {
    return [...new Set(this.options.pickerOrigins ?? [])];
  }
  get frameAncestors(): string {
    return this.pickerOrigins.length ? "'self' " + this.pickerOrigins.join(' ') : "'none'";
  }
  url(port: number) {
    return (
      this.publicOrigin ??
      `http://${this.host === '0.0.0.0' || this.host === '::' ? '127.0.0.1' : isIP(this.host) === 6 ? `[${this.host}]` : this.host}:${port}`
    );
  }
}
