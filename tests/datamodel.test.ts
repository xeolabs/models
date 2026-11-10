import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { fixture } from './helpers.js';
import { startModelBrowser } from '../src/server/ModelBrowserServer.js';
import { ServerModelsClient } from '../src/browser/ServerModelsClient.js';
import { acquisitionOptions } from './acquisition-helpers.js';

async function city() {
  const f = await fixture();
  const source = path.join(f.source, 'city.json');
  // CityJSON demonstrates that availability follows loader data, not an IFC-only test.
  fs.writeFileSync(
    source,
    JSON.stringify({
      type: 'CityJSON',
      version: '1.0',
      CityObjects: {
        building: { type: 'Building', children: ['part'], geometry: [] },
        part: { type: 'BuildingPart', parents: ['building'], geometry: [] },
      },
      vertices: [],
    }),
  );
  return { ...f, model: (await f.library.importFile({ path: source })).model! };
}

test('semantic-only sources expose DataModel JSON, including types and relationships, without advertising geometry', async () => {
  const f = await city();
  try {
    const available = await f.library.availableFormats(f.model.id);
    expect(available.formats.map((option) => option.format)).toEqual(['cityjson', 'datamodel']);
    expect(available.formats[1]).toMatchObject({
      entrypoint: 'model.datamodel.json',
      cached: false,
      source: 'converted',
    });
    const result = await f.library.getFormat(f.model.id, 'datamodel');
    expect(result.files.map((file) => file.path)).toEqual(['model.datamodel.json']);
    const file = await f.library.resolveFormatFile(f.model.id, 'datamodel', result.entrypoint);
    const json = JSON.parse(fs.readFileSync(file.path, 'utf8'));
    expect(json.version).toBe('1.0');
    expect(json.objects.map((object: { id: string }) => object.id).sort()).toEqual([
      'building',
      'part',
    ]);
    expect(json.relationships.length).toBeGreaterThan(0);
    const outputPath = path.join(f.root, 'download.json');
    expect(
      (
        await f.library.exportConvertedModel({
          modelId: f.model.id,
          format: 'datamodel',
          outputPath,
        })
      ).filename,
    ).toBe('model.datamodel.json');
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8'))).toEqual(json);
    fs.writeFileSync(file.path, 'corrupt');
    expect((await f.library.getFormat(f.model.id, 'datamodel')).cached).toBe(false);
    expect(JSON.parse(fs.readFileSync(file.path, 'utf8'))).toEqual(json);
  } finally {
    await f.close();
  }
});

test('geometry without a semantic graph does not advertise an empty DataModel JSON file', async () => {
  const f = await fixture();
  try {
    const source = path.join(f.source, 'triangle.obj');
    fs.writeFileSync(source, 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
    const model = (await f.library.importFile({ path: source })).model!;
    expect(
      (await f.library.availableFormats(model.id)).formats.map((option) => option.format),
    ).not.toContain('datamodel');
    await expect(f.library.getFormat(model.id, 'datamodel')).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  } finally {
    await f.close();
  }
});

test('DataModel JSON is discoverable over HTTP, downloadable as JSON, shareable across origins and removed with its owner', async () => {
  const f = await city();
  const server = await startModelBrowser({
    root: f.directory,
    port: 0,
    acquisition: acquisitionOptions(),
  });
  try {
    const client = await ServerModelsClient.open(server.url);
    const option = (await client.availableFormats(f.model.id)).formats.find(
      (option) => option.format === 'datamodel',
    )!;
    expect(option).toMatchObject({ cached: false, entrypoint: 'model.datamodel.json' });
    const url = client.hotloadUrl(f.model.id, 'datamodel', option.entrypoint);
    const origin = { Origin: 'https://other-viewer.example', 'Sec-Fetch-Site': 'cross-site' };
    const response = await fetch(url, { headers: origin });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('content-disposition')).toBeNull();
    const json = await response.json();
    expect(json.objects.length).toBe(2);
    const prepared = await client.getFormat(f.model.id, 'datamodel');
    expect(prepared.cached).toBe(true);
    const entry = await client.entryUrl(f.model.id, { format: 'datamodel' });
    const download = await fetch(entry + '?download=1');
    expect(download.headers.get('content-disposition')).toContain('model.datamodel.json');
    expect(await download.json()).toEqual(json);
    const publicDownload = await fetch(url + '?download=1', { headers: origin });
    expect(publicDownload.headers.get('content-disposition')).toContain('model.datamodel.json');
    expect(await publicDownload.json()).toEqual(json);
    expect(
      (await client.downloadFormats(f.model.id)).formats.some(
        (option) => option.format === 'datamodel',
      ),
    ).toBe(true);
    await f.library.delete(f.model.id);
    expect((await fetch(url)).status).toBe(404);
    expect(fs.existsSync(path.join(f.directory, '.cache/conversions', f.model.id))).toBe(false);
  } finally {
    await server.close();
    await f.close();
  }
});
