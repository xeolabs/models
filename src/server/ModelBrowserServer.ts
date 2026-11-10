import { PropertyRoutes } from './PropertyRoutes.js';
import { propertyQueryRoute } from './propertyQueryRoute.js';
import type { XeoIFCOptions } from '../conversion/XeoIFCRuntime.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { modelPickerProtocol } from '../browser/ModelPickerProtocol.js';
import { ModelsLibrary } from '../ModelsLibrary.js';
import { conversionFormats } from '../conversion/types.js';
import { ModelsError, fail } from '../domain/ModelsError.js';
import { parse, formats } from '../domain/schema.js';
import { relativeFile } from '../storage/paths.js';
import { mime } from '../storage/AssetStore.js';
import { ServerAccessPolicy, type ServerNetworkOptions } from './ServerAccessPolicy.js';
import { ProcessingRoutes } from './ProcessingRoutes.js';
import { AcquisitionRoutes } from './AcquisitionRoutes.js';
import { UploadSessions } from './UploadSessions.js';
import { modelFileRoute } from './modelFileRoute.js';
import type { AcquisitionServiceOptions } from '../acquisition/ModelAcquisitionService.js';
export interface BrowserServerOptions extends ServerNetworkOptions {
  xeoIFC?: XeoIFCOptions;
  root: string;
  appDirectory?: string;
  port?: number;
  acquisition?: AcquisitionServiceOptions;
}
async function body(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 ** 2) fail('INVALID_MODEL', 'Request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    fail('INVALID_MODEL', 'Expected JSON');
  }
}
export async function startModelBrowser(options: BrowserServerOptions) {
  const access = new ServerAccessPolicy(options);
  const library = await ModelsLibrary.open({
    root: options.root,
    xeoIFC: options.xeoIFC,
    processingWorker: true,
  });
  let acquisition: AcquisitionRoutes;
  try {
    acquisition = new AcquisitionRoutes(library, options.root, options.acquisition);
  } catch (error) {
    await library.close();
    throw error;
  }
  const uploads = new UploadSessions(),
    processing = new ProcessingRoutes(library);
  const properties = new PropertyRoutes(library);
  const json = (r: ServerResponse, data: unknown, status = 200) => {
    r.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    r.end(JSON.stringify({ ok: true, data }));
  };
  async function file(
    request: IncomingMessage,
    response: ServerResponse,
    p: string,
    type: string,
    attachment: boolean | string = false,
  ) {
    const stat = await fs.promises.stat(p);
    let start = 0,
      end = stat.size - 1,
      status = 200;
    const range = request.headers.range;
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!m || Number(m[1]) >= stat.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        response.end();
        return;
      }
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), end) : end;
      if (end < start) {
        response.writeHead(416);
        response.end();
        return;
      }
      status = 206;
      response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    response.writeHead(status, {
      'Content-Type': type,
      'Content-Length': Math.max(0, end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(attachment
        ? {
            'Content-Disposition':
              'attachment; filename="' +
              (typeof attachment === 'string'
                ? attachment.replace(/[^a-zA-Z0-9._-]/g, '_')
                : 'model.zip') +
              '"',
          }
        : {}),
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await pipeline(fs.createReadStream(p, { start, end: Math.max(start, end) }), response);
  }
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // The bundled viewer decoders compile WASM. JavaScript eval remains blocked.
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' data: blob:; object-src 'none'; frame-ancestors ${access.frameAncestors}`,
    );
    try {
      const port = (server.address() as { port: number }).port,
        origin = access.catalogOrigin(request, port),
        sharedFile = access.modelFileRequest(request, port);
      if (sharedFile) {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader(
          'Access-Control-Expose-Headers',
          'Content-Length, Content-Range, Accept-Ranges',
        );
        if (request.method === 'OPTIONS') {
          response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
          response.setHeader('Access-Control-Allow-Headers', 'Range');
          response.writeHead(204);
          response.end();
          return;
        }
      } else if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        if (request.method === 'OPTIONS') {
          const propertyQuery = propertyQueryRoute.test(
            new URL(request.url ?? '/', 'http://localhost').pathname,
          );
          response.setHeader('Access-Control-Allow-Methods', propertyQuery ? 'POST' : 'GET');
          if (propertyQuery) response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          response.writeHead(204);
          response.end();
          return;
        }
      }
      if (
        !sharedFile &&
        !origin &&
        !access.accepts(request, port) &&
        !access.pickerNavigation(request, port)
      ) {
        response.writeHead(403);
        response.end(
          JSON.stringify({
            ok: false,
            error: { code: 'FORBIDDEN', message: 'Request origin is not allowed' },
          }),
        );
        return;
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`),
        route = url.pathname;
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') &&
        request.headers['x-models-action'] !== 'explicit' &&
        !(request.method === 'POST' && propertyQueryRoute.test(route))
      )
        fail('CONFLICT', 'An explicit app action is required');
      const shared = modelFileRoute(route);
      if (shared && (request.method === 'GET' || request.method === 'HEAD')) {
        const format = z.enum([...formats, ...conversionFormats]).safeParse(shared[2]);
        if (!format.success) fail('UNSUPPORTED_FORMAT', 'Load model: unknown format');
        const resource = await library.resolveFormatFile(
          shared[1],
          format.data,
          decodeURIComponent(shared[3]),
        );
        response.setHeader('Cache-Control', 'no-store');
        await file(
          request,
          response,
          resource.path,
          resource.mime,
          url.searchParams.get('download') === '1'
            ? path.basename(decodeURIComponent(shared[3]))
            : false,
        );
        return;
      }
      const document = /^\/api\/models\/([a-f0-9-]{36})\/datamodel$/.exec(route);
      if (document && request.method === 'GET') {
        const mode = z
          .enum(['embedded', 'external'])
          .optional()
          .parse(url.searchParams.get('properties') ?? undefined);
        const resource = await library.resolveDataModelFile(document[1], { propertySetMode: mode });
        await file(
          request,
          response,
          resource.path,
          resource.mime,
          url.searchParams.get('download') === '1' ? 'model.datamodel.json' : false,
        );
        return;
      }
      if (await properties.handle(request, response, url, () => body(request))) return;
      if (await processing.handle(request, response, url, () => body(request))) return;
      if (await acquisition.handle(request, response, url)) return;
      const thumbnailRoute = /^\/api\/models\/([a-f0-9-]{36})\/thumbnail(\/status)?$/.exec(route);
      if (thumbnailRoute && request.method === 'GET') {
        if (thumbnailRoute[2]) json(response, await library.thumbnailStatus(thumbnailRoute[1]));
        else {
          const thumbnail = await library.resolveThumbnail(thumbnailRoute[1]);
          response.setHeader('Cache-Control', 'private, max-age=3600');
          await file(request, response, thumbnail.path, thumbnail.mime);
        }
        return;
      }
      if (route === '/api/picker' && request.method === 'GET') {
        json(response, {
          protocol: modelPickerProtocol,
          version: 1,
          allowedOrigins: access.pickerOrigins,
          library: await library.summary(),
        });
        return;
      }
      if (route === '/api/summary') {
        json(response, await library.summary());
        return;
      }
      if (route === '/api/formats') {
        json(response, formats);
        return;
      }
      if (route === '/api/tags') {
        json(response, await library.listTags());
        return;
      }
      if (route === '/api/models' && request.method === 'GET') {
        json(
          response,
          await library.page({
            text: url.searchParams.get('q') ?? undefined,
            format: (url.searchParams.get('format') || undefined) as any,
            formats: (url.searchParams.has('formats')
              ? url.searchParams.getAll('formats')
              : undefined) as any,
            sort: (url.searchParams.get('sort') || 'name') as any,
            provider: url.searchParams.get('provider') || undefined,
            tags: url.searchParams.getAll('tag'),
            limit: Number(url.searchParams.get('limit') ?? 48),
            offset: Number(url.searchParams.get('offset') ?? 0),
          }),
        );
        return;
      }
      if (route === '/api/imports' && request.method === 'POST') {
        json(response, uploads.create(), 201);
        return;
      }
      const upload = /^\/api\/imports\/([a-f0-9-]{36})(\/files|\/commit)?$/.exec(route);
      if (upload) {
        if (request.method === 'PUT' && upload[2] === '/files')
          json(
            response,
            await uploads.file(upload[1], url.searchParams.get('path') ?? '', request),
          );
        else if (request.method === 'POST' && upload[2] === '/commit')
          json(
            response,
            await uploads.commit(
              upload[1],
              parse(
                z
                  .object({
                    entrypoint: z.string(),
                    propertySetMode: z.enum(['embedded', 'external']).optional(),
                    name: z.string().optional(),
                    tags: z.array(z.string()).optional(),
                  })
                  .strict(),
                await body(request),
              ),
              library,
            ),
          );
        else if (request.method === 'DELETE') {
          uploads.remove(upload[1]);
          json(response, {});
        } else fail('INVALID_MODEL', 'Unsupported upload operation');
        return;
      }
      const representation =
        /^\/api\/models\/([a-f0-9-]{36})\/formats(?:\/([a-z0-9]+)(?:\/files\/(.+))?)?$/.exec(route);
      if (representation && request.method === 'GET') {
        const id = representation[1];
        if (!representation[2]) json(response, await library.availableFormats(id));
        else {
          const format = z.enum([...formats, ...conversionFormats]).safeParse(representation[2]);
          if (!format.success) fail('UNSUPPORTED_FORMAT', 'Get model format: unknown format');
          if (representation[3]) {
            const resource = await library.resolveFormatFile(
              id,
              format.data,
              decodeURIComponent(representation[3]),
            );
            response.setHeader('Cache-Control', 'no-store');
            await file(
              request,
              response,
              resource.path,
              resource.mime,
              url.searchParams.get('download') === '1'
                ? path.basename(decodeURIComponent(representation[3]))
                : false,
            );
          } else json(response, await library.getFormat(id, format.data));
        }
        return;
      }
      const conversion =
        /^\/api\/models\/([a-f0-9-]{36})\/(download-formats|conversions\/([a-z0-9]+)(\/download)?)$/.exec(
          route,
        );
      if (conversion) {
        const id = conversion[1];
        if (conversion[2] === 'download-formats' && request.method === 'GET') {
          json(response, await library.downloadFormats(id));
          return;
        }
        const format = z.enum(conversionFormats).safeParse(conversion[3]);
        if (!format.success)
          fail('UNSUPPORTED_FORMAT', 'Download conversion: unsupported output format');
        if (!conversion[4] && request.method === 'POST') {
          json(response, await library.convertModel({ modelId: id, format: format.data }));
          return;
        }
        if (conversion[4] && request.method === 'GET') {
          const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'models-download-'));
          try {
            const outputPath = path.join(directory, 'download');
            const result = await library.exportConvertedModel({
              modelId: id,
              format: format.data,
              outputPath,
            });
            await file(
              request,
              response,
              outputPath,
              result.filename.endsWith('.zip') ? 'application/zip' : mime(result.filename),
              result.filename,
            );
          } finally {
            fs.rmSync(directory, { recursive: true, force: true });
          }
          return;
        }
        fail('INVALID_MODEL', 'Unsupported conversion operation');
      }
      const model = /^\/api\/models\/([a-f0-9-]{36})(?:\/(files\/(.+)|bundle))?$/.exec(route);
      if (model) {
        const id = model[1];
        if (model[3] && request.method === 'GET') {
          const resource = await library.resolveFile(id, decodeURIComponent(model[3]));
          await file(
            request,
            response,
            resource.path,
            resource.mime,
            url.searchParams.get('download') === '1'
              ? path.basename(decodeURIComponent(model[3]))
              : false,
          );
          return;
        }
        if (model[2] === 'bundle' && request.method === 'GET') {
          const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-download-'));
          try {
            const output = path.join(dir, 'model.zip');
            await library.exportModel({ modelId: id, outputPath: output });
            await file(request, response, output, 'application/zip', true);
          } finally {
            fs.rmSync(dir, { recursive: true, force: true });
          }
          return;
        }
        if (!model[2] && request.method === 'GET') {
          const m = await library.get(id);
          if (!m) fail('MODEL_NOT_FOUND', 'Model does not exist');
          json(response, m);
          return;
        }
        if (!model[2] && request.method === 'PATCH') {
          json(response, await library.update(id, { metadata: await body(request) }));
          return;
        }
        if (!model[2] && request.method === 'DELETE') {
          await library.delete(id);
          json(response, {});
          return;
        }
      }
      if (route === '/api/validate' && request.method === 'POST') {
        json(response, await library.validate());
        return;
      }
      if (route === '/api/gc' && request.method === 'POST') {
        const o = parse(
          z.object({ confirmed: z.boolean().default(false) }).strict(),
          await body(request),
        );
        json(response, await library.gc({ dryRun: !o.confirmed }));
        return;
      }
      if (route.startsWith('/api/')) fail('MODEL_NOT_FOUND', 'Unknown endpoint');
      if (request.method !== 'GET') fail('INVALID_MODEL', 'Unsupported HTTP method');
      const app = options.appDirectory ?? fileURLToPath(new URL('../app/', import.meta.url)),
        name =
          route === '/' || route === '/picker' ? 'index.html' : decodeURIComponent(route.slice(1));
      // HTML and the stable API entry point must always describe the current build.
      // Hashed modules remain available to tabs opened before an app update.
      response.setHeader(
        'Cache-Control',
        name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
      await file(
        request,
        response,
        relativeFile(app, name),
        (
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
          } as Record<string, string>
        )[path.extname(name)] ?? mime(name),
      );
    } catch (e) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const error =
        e instanceof ModelsError
          ? e
          : new ModelsError('FILE_IO_ERROR', 'Request failed', { cause: e });
      const status = error.code.endsWith('NOT_FOUND')
        ? 404
        : [
              'CONFLICT',
              'PROPERTY_REVISION_MISMATCH',
              'PROPERTIES_NOT_READY',
              'JOB_CONFLICT',
            ].includes(error.code)
          ? 409
          : 400;
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(
        JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }),
      );
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 7420, access.host, () => resolve());
    });
  } catch (e) {
    uploads.close();
    await library.close();
    throw e;
  }
  return {
    server,
    url: access.url((server.address() as { port: number }).port),
    async close() {
      await acquisition.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      uploads.close();
      await library.close();
    },
  };
}
