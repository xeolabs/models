import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import yauzl from 'yauzl';
import { fixture } from './helpers.js';
import { acquisitionOptions } from './acquisition-helpers.js';
import { ModelsLibrary } from '../src/ModelsLibrary.js';
import { ConversionCache } from '../src/conversion/ConversionCache.js';
import { CONVERSION_LIMITS } from '../src/conversion/limits.js';
import { writeBundle, extractArchive } from '../src/importing/Bundle.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';

interface StreamChunk {
  id: string;
  uri: string;
  role: string;
  counts: { objects: number };
  dependencies: { chunks: { id: string; uri?: string }[] };
}
interface StreamIndex {
  format: string;
  chunks: StreamChunk[];
  rootChunkIds: string[];
}

async function zipNames(file: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) return reject(error);
      const names: string[] = [];
      archive.on('error', reject);
      archive.on('end', () => resolve(names));
      archive.on('entry', (entry) => {
        names.push(entry.fileName);
        archive.readEntry();
      });
      archive.readEntry();
    });
  });
}

test('real SDK streams preserve the complete chunk graph, survive reopening and repair damaged chunks', async () => {
  const f = await fixture();
  let reopened: ModelsLibrary | undefined;
  try {
    const source = path.join(f.source, 'buildings.obj');
    fs.writeFileSync(
      source,
      Array.from({ length: 1100 }, (_, i) => {
        const x = (i % 40) * 10,
          y = Math.floor(i / 40) * 10,
          vertex = i * 3 + 1;
        return `o Building${i}\nv ${x} ${y} 0\nv ${x + 1} ${y} 0\nv ${x} ${y + 1} 0\nf ${vertex} ${vertex + 1} ${vertex + 2}\n`;
      }).join(''),
    );
    const model = (await f.library.importFile({ path: source })).model!;
    const options = await f.library.availableFormats(model.id);
    expect(options.formats.find((item) => item.format === 'xgfstream')).toMatchObject({
      cached: false,
      source: 'converted',
    });
    const stream = await f.library.getFormat(model.id, 'xgfstream');
    expect(stream.entrypoint).toBe('index.runtime.json');
    expect(stream.cached).toBe(false);
    const indexFile = await f.library.resolveFormatFile(model.id, 'xgfstream', 'index.json');
    const index: StreamIndex = JSON.parse(fs.readFileSync(indexFile.path, 'utf8'));
    expect(index.format).toBe('XGFStreamingIndex');
    expect(index.rootChunkIds.length).toBeGreaterThan(1);
    expect(index.chunks.reduce((sum, chunk) => sum + chunk.counts.objects, 0)).toBe(1100);
    const byId = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
    for (const chunk of index.chunks) {
      expect(stream.files.some((file) => file.path === chunk.uri)).toBe(true);
      for (const dependency of chunk.dependencies.chunks) {
        expect(byId.has(dependency.id)).toBe(true);
        if (dependency.uri) expect(byId.get(dependency.id)?.uri).toBe(dependency.uri);
      }
    }
    await f.library.close();
    reopened = await ModelsLibrary.open({ root: f.directory });
    expect(await reopened.getFormat(model.id, 'xgfstream')).toEqual({ ...stream, cached: true });
    const damaged = await reopened.resolveFormatFile(model.id, 'xgfstream', index.chunks[0].uri);
    fs.writeFileSync(damaged.path, 'damaged chunk');
    // Reading the index need not read every chunk; only the damaged chunk's request repairs it.
    await reopened.resolveFormatFile(model.id, 'xgfstream', 'index.json');
    expect(fs.readFileSync(damaged.path, 'utf8')).toBe('damaged chunk');
    const repaired = await reopened.resolveFormatFile(model.id, 'xgfstream', index.chunks[0].uri);
    // Some source importers allocate fresh resource IDs when the package is rebuilt.
    expect(createHash('sha256').update(fs.readFileSync(repaired.path)).digest('hex')).toBe(
      repaired.sha256,
    );
    expect([2, 3]).toContain(fs.readFileSync(repaired.path).readUInt32LE(0));
    const outputPath = path.join(f.root, 'stream.zip');
    const exported = await reopened.exportConvertedModel({
      modelId: model.id,
      format: 'xgfstream',
      outputPath,
    });
    expect(exported.filename).toBe('model-xgfstream.zip');
    expect((await zipNames(outputPath)).sort()).toEqual(
      exported.files.map((file) => file.path).sort(),
    );
    await reopened.delete(model.id);
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions', model.id))).toBe(false);
    await expect(
      reopened.resolveFormatFile(model.id, 'xgfstream', stream.entrypoint),
    ).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' });
  } finally {
    await reopened?.close();
    await f.close();
  }
}, 60000);

test('HTTP serves the full stream with relative chunk URLs, CORS and byte ranges', async () => {
  const f = await fixture();
  const source = path.join(f.source, 'triangle.obj');
  fs.writeFileSync(source, 'o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const model = (await f.library.importFile({ path: source })).model!;
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    allowedOrigins: ['http://viewer.example'],
    acquisition: acquisitionOptions(),
  });
  const headers = { Origin: 'http://viewer.example' };
  try {
    const client = await ServerModelsClient.open(server.url);
    // A direct request for the stream entry point also generates it on demand.
    const direct = client.formatFileUrl(model.id, 'xgfstream', 'index.runtime.json');
    const entry = await fetch(direct, { headers });
    expect(entry.status).toBe(200);
    expect(entry.headers.get('content-type')).toContain('application/json');
    expect(entry.headers.get('access-control-allow-origin')).toBe(headers.Origin);
    expect((await entry.json()).format).toBe('XGFStreamingRuntimeIndex');
    expect(await client.entryUrl(model.id, { format: 'xgfstream' })).toBe(direct);
    const representation = await client.getFormat(model.id, 'xgfstream');
    expect(representation.cached).toBe(true);
    const index: StreamIndex = await (
      await fetch(new URL('index.json', direct), { headers })
    ).json();
    const get = vi.spyOn(ConversionCache.prototype, 'get');
    try {
      for (const chunk of index.chunks) {
        const url = new URL(chunk.uri, direct);
        const response = await fetch(url, { headers });
        expect(response.status).toBe(200);
        expect(response.headers.get('access-control-allow-origin')).toBe(headers.Origin);
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          representation.files.find((file) => file.path === chunk.uri)?.sha256,
        );
        const partial = await fetch(url, { headers: { ...headers, Range: 'bytes=0-3' } });
        expect(partial.status).toBe(206);
        expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0, 4));
      }
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
    expect((await fetch(direct, { headers: { Origin: 'http://untrusted.example' } })).status).toBe(
      403,
    );
    expect((await fetch(new URL('manifest.json', direct))).status).toBe(404);
    const zip = await fetch(client.conversionDownloadUrl(model.id, 'xgfstream'), { headers });
    expect(zip.headers.get('content-disposition')).toContain('model-xgfstream.zip');
    const output = path.join(f.root, 'http.zip');
    fs.writeFileSync(output, Buffer.from(await zip.arrayBuffer()));
    expect((await zipNames(output)).sort()).toEqual(
      representation.files.map((file) => file.path).sort(),
    );
    await f.library.delete(model.id);
    expect((await fetch(direct)).status).toBe(404);
    expect((await fetch(new URL(index.chunks[0].uri, direct))).status).toBe(404);
  } finally {
    await server.close();
    await f.close();
  }
});

test('generated streams can cache and export more than 64 files without relaxing archive import limits', async () => {
  const f = await fixture();
  try {
    const id = randomUUID(),
      fingerprint = 'a'.repeat(64);
    const files = Array.from({ length: 80 }, (_, i) => {
      const name = `chunks/part-${i}.xgf`,
        bytes = Buffer.from(`chunk ${i}`);
      fs.mkdirSync(path.join(f.source, 'chunks'), { recursive: true });
      fs.writeFileSync(path.join(f.source, name), bytes);
      return {
        path: name,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    });
    const cache = new ConversionCache(f.directory);
    const install = await cache.prepareInstall(
      id,
      fingerprint,
      {
        modelId: id,
        format: 'xgfstream',
        entrypoint: files[0].path,
        files,
        warnings: [],
        cached: false,
        createdAt: new Date().toISOString(),
      },
      f.source,
    );
    try {
      install.commit();
    } finally {
      await install.cleanup();
    }
    expect((await cache.get(id, fingerprint, 'xgfstream'))?.files).toHaveLength(80);
    const output = path.join(f.root, 'many.zip');
    const entries = files.map((file) => ({
      path: path.join(f.source, file.path),
      name: file.path,
    }));
    await expect(writeBundle(output, entries)).rejects.toMatchObject({ code: 'INVALID_BUNDLE' });
    await writeBundle(output, entries, { maxEntries: CONVERSION_LIMITS.files });
    expect(await zipNames(output)).toHaveLength(80);
    await expect(extractArchive(output, { requireManifest: false })).rejects.toMatchObject({
      code: 'INVALID_BUNDLE',
    });
  } finally {
    await f.close();
  }
});
