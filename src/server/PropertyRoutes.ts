import { propertyQueryRoute } from './propertyQueryRoute.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';
import type { ModelsLibrary } from '../ModelsLibrary.js';
import type {
  PropertySetMode,
  PropertySetQuery,
  ObjectPropertiesQuery,
  PropertyObjectQuery,
} from '../properties/types.js';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/**
 * These POST routes only read properties. Keeping them separate from mutations
 * allows trusted viewer origins to batch IDs without granting write access.
 */
export class PropertyRoutes {
  constructor(private readonly library: ModelsLibrary) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    body: () => Promise<unknown>,
  ): Promise<boolean> {
    const info = /^\/api\/models\/([a-f0-9-]{36})\/properties$/.exec(url.pathname);
    if (info && request.method === 'GET') {
      await this.send(request, response, await this.library.propertiesInfo(info[1]), false);
      return true;
    }
    if (info && request.method === 'PATCH') {
      const input = (await body()) as { mode: PropertySetMode };
      await this.send(
        request,
        response,
        await this.library.configureProperties(info[1], input),
        false,
      );
      return true;
    }
    const match = propertyQueryRoute.exec(url.pathname);
    if (!match || request.method !== 'POST') return false;
    const input = await body();
    const data =
      match[2] === 'property-sets'
        ? await this.library.getPropertySets(match[1], input as PropertySetQuery)
        : match[2] === 'object-properties'
          ? await this.library.getObjectProperties(match[1], input as ObjectPropertiesQuery)
          : await this.library.queryPropertyObjects(match[1], input as PropertyObjectQuery);
    await this.send(request, response, data, true);
    return true;
  }
  private async send(
    request: IncomingMessage,
    response: ServerResponse,
    data: unknown,
    revisioned: boolean,
  ): Promise<void> {
    const json = Buffer.from(JSON.stringify({ ok: true, data }));
    const etag = '"' + createHash('sha256').update(json).digest('hex') + '"';
    response.setHeader('Vary', 'Origin, Accept-Encoding');
    response.setHeader('Cache-Control', revisioned ? 'private, no-cache' : 'no-store');
    response.setHeader('ETag', etag);
    response.setHeader('Access-Control-Expose-Headers', 'ETag');
    const accepted = String(request.headers['accept-encoding'] ?? '')
      .split(',')
      .map((item) => item.trim());
    const permits = (name: string) =>
      accepted.some((item) => {
        const [encoding, ...parameters] = item.split(';').map((part) => part.trim());
        return (
          encoding === name && !parameters.some((parameter) => /^q=0(?:\.0*)?$/.test(parameter))
        );
      });
    let bytes = json;
    if (json.length >= 1024 && permits('br')) {
      bytes = await brotli(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
      response.setHeader('Content-Encoding', 'br');
    } else if (json.length >= 1024 && permits('gzip')) {
      bytes = await gz(json, { level: 4 });
      response.setHeader('Content-Encoding', 'gzip');
    }
    if (response.destroyed) return;
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': bytes.length });
    response.end(bytes);
  }
}
