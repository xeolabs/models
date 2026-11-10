import type { IncomingMessage, ServerResponse } from 'node:http';
import { ModelsLibrary } from '../ModelsLibrary.js';
import { fail } from '../domain/ModelsError.js';

/**
 * Queue actions use the same origin and explicit-action checks as other app writes.
 */
export class ProcessingRoutes {
  constructor(private readonly library: ModelsLibrary) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    readBody: () => Promise<unknown>,
  ) {
    if (!url.pathname.startsWith('/api/processing')) return false;
    let result: unknown;
    if (url.pathname === '/api/processing' && request.method === 'GET')
      result = await this.library.processing(url.searchParams.get('modelId') ?? undefined);
    else if (url.pathname === '/api/processing/settings' && request.method === 'PATCH')
      result = await this.library.configureProcessing(
        (await readBody()) as Parameters<ModelsLibrary['configureProcessing']>[0],
      );
    else {
      const action =
        /^\/api\/processing\/(?:jobs\/([a-f0-9-]{36})\/(cancel|retry)|models\/([a-f0-9-]{36})\/prepare)$/.exec(
          url.pathname,
        );
      if (!action || request.method !== 'POST')
        fail('INVALID_MODEL', 'Unknown processing endpoint');
      if (action[3]) result = await this.library.prepareIFC(action[3]);
      else if (action[2] === 'retry') result = await this.library.retryConversion(action[1]);
      else {
        await this.library.cancelConversion(action[1]);
        result = { cancelRequested: true };
      }
    }
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ ok: true, data: result }));
    return true;
  }
}
