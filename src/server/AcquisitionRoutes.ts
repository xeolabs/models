import { SketchfabAuthentication } from './SketchfabAuthentication.js';
import { ProviderHttpClient } from '../providers/ProviderHttpClient.js';
import { ProviderPreviews } from './ProviderPreviews.js';
import { providerInfo } from '../providers/ProviderInfo.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { ModelsLibrary } from '../ModelsLibrary.js';
import type { AcquisitionServiceOptions } from '../acquisition/ModelAcquisitionService.js';
import type { ProviderId } from '../providers/types.js';
import { fail } from '../domain/ModelsError.js';
import { encode } from '../domain/schema.js';
function parse<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  _code: 'INVALID_PLAN',
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail('INVALID_PLAN', 'Acquisition request: invalid options');
  return result.data;
}
async function body(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    fail('INVALID_PLAN', 'Acquisition request: JSON is required');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8 * 1024 ** 2) fail('INVALID_PLAN', 'Acquisition request: body exceeds 8 MiB');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    fail('INVALID_PLAN', 'Acquisition request: invalid JSON');
  }
}

/**
 * HTTP jobs return immediately; the server owns their execution and persists their progress.
 */
export class AcquisitionRoutes {
  private readonly previews: ProviderPreviews;
  private readonly authentication: SketchfabAuthentication;
  constructor(
    private readonly library: ModelsLibrary,
    libraryRoot: string,
    private readonly options: AcquisitionServiceOptions = {},
  ) {
    this.previews = new ProviderPreviews(options);
    this.authentication = new SketchfabAuthentication(libraryRoot, new ProviderHttpClient(options));
    this.options = { ...options, sketchfabCredential: () => this.authentication.credential() };
  }
  async close() {
    await this.previews.close();
  }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/acquisition/')) return false;
    const send = (data: unknown, status = 200) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(encode({ ok: true, data }));
    };
    if (!['GET', 'POST'].includes(request.method ?? ''))
      fail('INVALID_PLAN', 'Acquisition request: unsupported method');
    if (request.method === 'POST' && request.headers['x-models-action'] !== 'explicit')
      fail('CONFLICT', 'Acquisition request: an explicit app action is required');
    if (url.pathname === '/api/acquisition/sketchfab/auth') {
      send(
        request.method === 'POST'
          ? await this.authentication.connect(await body(request))
          : this.authentication.status(),
      );
      return true;
    }
    if (url.pathname === '/api/acquisition/sketchfab/verify' && request.method === 'POST') {
      send(await this.authentication.verify());
      return true;
    }
    if (url.pathname === '/api/acquisition/sketchfab/disconnect' && request.method === 'POST') {
      send(this.authentication.disconnect());
      return true;
    }
    const a = await this.library.acquisition(this.options),
      route = url.pathname.slice('/api/acquisition'.length);
    const query = {
      limit: Number(url.searchParams.get('limit') ?? 50),
      offset: Number(url.searchParams.get('offset') ?? 0),
    };
    if (request.method === 'GET') {
      if (route === '/providers') {
        send(a.providers.list().map((p) => p.getInfo?.() ?? providerInfo[p.id]));
        return true;
      }
      if (route === '/search') {
        const selected = url.searchParams.getAll('provider');
        const found = await a.search({
          text: url.searchParams.get('q') ?? undefined,
          providers: selected.length ? (selected as ProviderId[]) : undefined,
          limit: Number(url.searchParams.get('limit') ?? 20),
        });
        this.previews.remember(found.items);
        send(found);
        return true;
      }
      const remote = /^\/models\/([a-z0-9-]+)\/([^/]+)(\/(?:downloads|preview))?$/.exec(route);
      if (remote) {
        let remoteId: string;
        try {
          remoteId = decodeURIComponent(remote[2]);
        } catch {
          fail('INVALID_PLAN', 'Remote model: invalid encoded identifier');
        }
        if (remote[3] === '/preview') {
          const bytes = await this.previews.get(remote[1] as ProviderId, remoteId, () =>
            a.getPreviewUrl(remote[1] as ProviderId, remoteId),
          );
          response.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Length': bytes.length,
            'Cache-Control': 'private, max-age=3600',
          });
          response.end(bytes);
          return true;
        }
        send(
          remote[3]
            ? await a.getDownloads(remote[1] as ProviderId, remoteId)
            : await a.getModel(remote[1] as ProviderId, remoteId),
        );
        return true;
      }
      if (route === '/plans') {
        send(await a.listPlans(query));
        return true;
      }
      if (route === '/jobs') {
        send(await a.listJobs(query));
        return true;
      }
      if (route === '/cache') {
        send(await a.cacheStats());
        return true;
      }
      const plan = /^\/plans\/([a-f0-9-]{36})$/.exec(route);
      if (plan) {
        const p = await a.getPlan(plan[1]);
        if (!p) fail('PLAN_NOT_FOUND', 'Plan no longer exists');
        send(p);
        return true;
      }
      const job = /^\/jobs\/([a-f0-9-]{36})$/.exec(route);
      if (job) {
        const j = await a.getJob(job[1]);
        if (!j) fail('JOB_NOT_FOUND', 'Job no longer exists');
        send({ ...j, items: await a.getJobItems(job[1]) });
        return true;
      }
      const model = /^\/history\/([a-f0-9-]{36})$/.exec(route);
      if (model) {
        send(await a.getAcquisitions(model[1]));
        return true;
      }
    } else {
      const value = await body(request);
      if (route === '/plans') {
        send(await a.createPlan(value), 201);
        return true;
      }
      if (route === '/plans/import') {
        send(await a.importPlan(value), 201);
        return true;
      }
      const execute = /^\/plans\/([a-f0-9-]{36})\/execute$/.exec(route);
      if (execute) {
        const options = parse(
          z
            .object({
              confirmed: z.literal(true),
              concurrency: z.number().int().min(1).max(4).optional(),
              continueOnError: z.boolean().optional(),
            })
            .strict(),
          value,
          'INVALID_PLAN',
        );
        send(
          await a.startPlan(execute[1], {
            concurrency: options.concurrency,
            continueOnError: options.continueOnError,
          }),
          202,
        );
        return true;
      }
      const job = /^\/jobs\/([a-f0-9-]{36})\/(resume|cancel)$/.exec(route);
      if (job) {
        if (job[2] === 'cancel') {
          await a.cancelJob(job[1]);
          send({ requested: true, job: await a.getJob(job[1]) });
        } else {
          parse(z.object({ confirmed: z.literal(true) }).strict(), value, 'INVALID_PLAN');
          send(await a.startResumeJob(job[1]), 202);
        }
        return true;
      }
      if (route === '/cache/clear') {
        parse(z.object({ confirmed: z.literal(true) }).strict(), value, 'INVALID_PLAN');
        send(await a.clearCache());
        return true;
      }
    }
    fail('MODEL_NOT_FOUND', 'Unknown acquisition endpoint');
  }
}
