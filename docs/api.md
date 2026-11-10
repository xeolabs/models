# TypeScript API

`ModelsLibrary.open({root, create?})` opens or initializes a catalog. All public methods return promises. Call `close()` in `finally`; closed libraries reject new work and wait for accepted operations before closing SQLite.

| Area        | Methods                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog     | `create({metadata})`, `get(id)`, `list(query)`, `page(query)`, `search(query)`, `update(id,{metadata})`, `delete(id)`                                                |
| Tags        | `listTags()`, `addTags(id,tags)`, `removeTags(id,tags)`                                                                                                              |
| Imports     | `importFile({path,name?,tags?,source?,dryRun?})`, `importDirectory({path,entrypoint,...})`, `importManifest({manifestPath,dryRun?})`, `importBundle({path,dryRun?})` |
| Files       | `getAsset(hash)`, `resolveAsset(hash)`, `resolveFile(id,relativePath)`, `exportModel({modelId,outputPath})`                                                          |
| Maintenance | `summary()`, `validate()`, `gc({dryRun:true})`                                                                                                                       |
| Acquisition | `acquisition(options?)` returns the shared acquisition service                                                                                                       |

`ModelRecord` contains `id`, `metadata`, `entrypoint`, `format`, `files`, `warnings`, `createdAt`, `updatedAt`. Metadata contains `name`, `description`, `tags`, `source`. File records contain a relative `path`, `assetId`, `bytes` and `mime`. Updates change metadata; immutable file replacements are new imports. Source metadata includes provider, remote ID, resolution, URL, license and attribution.

Search accepts text, format, provider, tags (AND semantics), limit, offset, sort (`name`, `createdAt`, `updatedAt`) and direction. Results have deterministic tie-breaking by UUID. `page` adds total/count information.

The acquisition service exposes `search`, `getModel`, `getDownloads`, `createPlan`, `getPlan`, `listPlans`, `getPlanItems`, `importPlan`, `exportPlan`, `executePlan`, `startPlan`, `getJob`, `listJobs`, `getJobItems`, `resumeJob`, `startResumeJob`, `cancelJob`, `acquire`, `getAcquisitions`, `cacheStats` and `clearCache`. `startPlan` returns promptly; `executePlan` waits for completion.

Plan criteria include providers, explicit assets or queries, `resolution` or `resolutions` (array or `all`), format, model count, total-byte budget, optional `maxPackageBytes` and `maxPolygons`. Plans persist exact filenames, package paths, sizes, checksums and licenses, with a canonical SHA-256 fingerprint. They cannot be updated. Unknown sizes require an explicit conservative reservation policy. Existing acquisitions are skipped unless forced.

The browser export contains only `ServerModelsClient`. Its `open`, `search`, `get`, `fileUrl`, `entryUrl`, `bundleUrl`, `downloadFormats` and `conversionDownloadUrl` use the server; it neither opens SQLite nor creates GPU objects. The server also serves this module at `/models-client.js` for direct browser imports.

Public failures use `ModelsError` with a stable `code` and preserved underlying cause. HTTP/CLI JSON uses `{ok:true,data}` or `{ok:false,error:{code,message}}`.

## On-demand SDK conversions

```ts
const available = await library.downloadFormats(modelId);
if (available.formats.some((option) => option.format === 'glb')) {
  const output = await library.exportConvertedModel({
    modelId,
    format: 'glb',
    outputPath: './model-download', // Must not already exist.
  });
  console.log(output.filename, output.warnings);
}
```

`downloadFormats(id)` inspects the source through the SDK and returns `ModelDownloadFormats`. Each option contains `format`, `warnings`, `cached` and, when cached, `bytes`. For IFC, discovery prepares and caches XGF and DataModel JSON once; other sources are only inspected. Unsupported source formats return an empty list and explanation; malformed SDK inputs reject with a typed error.

`convertModel({modelId,format})` generates or reuses a `ConvertedModel`: entry point, file hashes/sizes, warnings, timestamp and cache-hit status. It does not create another catalog record. `exportConvertedModel({modelId,format,outputPath})` also writes a portable download: one file when possible, or a ZIP containing companion files. Its `filename` identifies the actual output extension, independently of `outputPath`.

`delete(id)` removes conversion caches immediately. Original shared assets retain the existing GC semantics. Conversion failures use `CONVERSION_FAILED`, `CONVERSION_CANCELLED` or `CONVERSION_TIMEOUT`; incompatible formats use `UNSUPPORTED_FORMAT`.

HTTP endpoints:

- `GET /api/models/:id/download-formats`
- `POST /api/models/:id/conversions/:format` (same-origin with `X-Models-Action: explicit`)
- `GET /api/models/:id/conversions/:format/download` (generates on demand)

The browser client offers `downloadFormats(id, signal?)` and `conversionDownloadUrl(id, format)`. Trusted configured viewer origins can read options and download conversions; arbitrary origins remain rejected.

## Discover and load a format

Both `ModelsLibrary` and `ServerModelsClient` expose `availableFormats(modelId)` and `getFormat(modelId, format)`. Discovery includes the original and compatible converted formats, with `entrypoint`, `source`, `cached`, byte size when known and format notices. IFC discovery prepares its reusable XGF and DataModel pair; other sources are only inspected. If the SDK cannot inspect a source, the original remains discoverable and the result includes a warning.

`getFormat` prepares just the requested format and returns its entry point, relative file paths, SHA-256 hashes and notices. The original format is served directly. Conversions reuse the same verified cache used by the app; deleting the model invalidates every representation.

```ts
import { ServerModelsClient } from '@xeokit/models/browser';

const client = await ServerModelsClient.open('http://127.0.0.1:7420');
const models = await client.search();
if (models.items.length) {
  const id = models.items[0].id;
  const available = await client.availableFormats(id);
  console.log(available.formats);
  if (available.formats.some((option) => option.format === 'xgf')) {
    const representation = await client.getFormat(id, 'xgf');
    const entry = client.formatFileUrl(id, 'xgf', representation.entrypoint);
    console.log(entry, representation.files);
    // Or prepare the format and obtain its entry URL in a single call:
    console.log(await client.entryUrl(id, { format: 'xgf' }));
  }
}
```

These URLs serve individual model files, not ZIP downloads. Relative texture/buffer URLs remain under the selected representation. A DataModel JSON companion, when present, is listed in `files` and has its own `formatFileUrl`. Studio loads that companion with XGF automatically. The original `entryUrl(id)` behavior is unchanged. Browser methods that make requests accept an optional AbortSignal; `entryUrl` accepts it in the options object.

For local Node use, `library.resolveFormatFile(id, format, relativePath)` prepares/reuses the representation and returns `{path, mime, bytes, sha256}`. Only files belonging to that representation can be resolved. Use `exportConvertedModel` when a portable download with companion files is needed.

Read-only HTTP resources, also available to configured viewer origins:

- `GET /api/models/:id/formats`
- `GET /api/models/:id/formats/:format`
- `GET /api/models/:id/formats/:format/files/:relativePath`

XGF conversions use the v3 container to retain authored coordinate information. This avoids interpreting a Y-up source as Z-up when a viewer switches to XGF.

## Retrieve native DataModel JSON

The generated format key is `datamodel`. It is discoverable only when the source loader creates semantic objects, including IFC loaded with XeoIFC. The SDK's `DataModelExporter` writes `model.datamodel.json` in its native version 1.0 structure; catalog metadata is kept separate.

```ts
const available = await client.availableFormats(id);
const option = available.formats.find((item) => item.format === 'datamodel');
if (option) {
  // Prepares just the semantic output and returns its JSON URL.
  const url = await client.entryUrl(id, { format: 'datamodel' });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`DataModel: HTTP ${response.status}`);
  const dataModelJSON = await response.json();
  console.log(dataModelJSON.objects, dataModelJSON.propertySets, dataModelJSON.relationships);
  // Public file link: no conversion is needed merely to construct it.
  console.log(client.hotloadUrl(id, 'datamodel', option.entrypoint));
}
```

For Node, use `library.getFormat(id, 'datamodel')`, then `library.resolveFormatFile(id, 'datamodel', 'model.datamodel.json')`. The usual cache verification and deletion rules apply. Add `?download=1` to either file URL to download the raw JSON as an attachment. Full-package exports may also include source notices and therefore return a ZIP. Existing geometry companions remain available. See [loading the JSON with xeokit](model-links.md#load-datamodel-json-with-xeokit-sdk-v3).

## Serve a complete XGF stream

Start Models with an explicit viewer origin (use the viewer's actual scheme,
hostname and port):

```sh
models --library ./my-models serve --host 0.0.0.0 --port 7420 --allow-origin http://viewer.local:5173
```

```ts
import { ServerModelsClient } from '@xeokit/models/browser';

const client = await ServerModelsClient.open('http://192.168.1.10:7420');
const page = await client.search();
if (page.items.length) {
  const id = page.items[0].id;
  const available = await client.availableFormats(id);
  if (available.formats.some((item) => item.format === 'xgfstream')) {
    const url = await client.entryUrl(id, { format: 'xgfstream' });
    // Give this URL to a xeokit SDK v3 XGF streaming viewer.
    console.log(url);
  }
}
```

The URL ends in `/api/models/:id/formats/xgfstream/files/index.runtime.json`.
The JSON is the SDK's compact runtime index, not an API response envelope.
Expand it with `readXGFStreamingRuntimeIndex`; resolve each resulting chunk's
`uri` against the index URL with `new URL(chunk.uri, url)`. When using
`XGFStreamingLoader` directly, also pass `manifests: index.chunks` and
`coordinateSystem: index.coordinateSystem` in the load options. The view-stream
controller handles that coordinate information itself. Dependencies and
texture/material asset libraries use the same relative URL layout. The readable
`index.json` and any DataModel companion are also available through
`formatFileUrl`. Files support byte-range GET requests.

`ModelRepresentationFormat` includes generated `xgfstream` alongside original
`ModelFormat` values. The same key works with `ModelsLibrary.getFormat`,
`resolveFormatFile`, `convertModel` and `exportConvertedModel` in Node. Discovery
does not generate chunks; the first format/file request does. Deleting the model
deletes the cached dataset and makes all its URLs unavailable.

Use HTTPS on both services when the viewer is hosted over HTTPS. Configure the
server's allowlist for each viewer origin; Models does not enable wildcard CORS.

## Public model file links

Use `ServerModelsClient.hotloadUrl(modelId, format, entrypoint)` to build a
copyable URL without fetching or generating model data. The `entrypoint` is
included in every `availableFormats` option. After preparing a representation,
other paths from its `files` can be passed to the same method.

```ts
const available = await client.availableFormats(modelId);
const option = available.formats.find((item) => item.format === 'xgfstream');
if (option) {
  console.log(client.hotloadUrl(modelId, option.format, option.entrypoint));
}
```

These URLs use `/models/:id/formats/:format/files/:relativePath`. They serve files
inline, with no API envelope or redirect. GET and HEAD support any browser origin,
with credential-free CORS and byte ranges. OPTIONS accepts GET/HEAD and Range.
The first file request prepares an uncached format. Only files recorded in that
representation can be served; the cache manifest and arbitrary filesystem paths
remain inaccessible. The existing `/api` routes and their allowlists are unchanged.

The recipient can fetch the copied URL directly without opening the catalog API.
See [model links](model-links.md) for the SDK streaming example and network setup.

## IFC providers and engine configuration

`ProviderId` includes `buildingsmart` and `buildingsmart-community`. `BuildingSmartProvider` and `BuildingSmartCommunityProvider` are exported and registered by default. Both use the existing search, immutable-plan and acquisition APIs. IFC is an accepted plan format; the provider variant is `original`.

`OpenLibraryOptions.xeoIFC?: XeoIFCOptions` accepts `runtimeDirectory` and an optional `licenceKey`; absent options use the server's XeoIFC environment configuration. `startModelBrowser` also accepts `xeoIFC`. `availableFormats`, `getFormat`, `convertModel`, `resolveFormatFile` and the browser client's HTTP format methods retain their existing contracts. [IFC details and runnable setup](ifc-providers.md).

## Processing queue

`ModelsLibrary` and `ServerModelsClient` expose `processing(modelId?)`, `configureProcessing(patch)`, `prepareIFC(modelId)`, `cancelConversion(jobId)` and `retryConversion(jobId)`. Node also exposes `processingSettings()`. Preparation and retry return a queued job immediately; `getFormat` still waits for a completed, verified output. Browser mutations require the Models server's own origin and explicit-action header, which the client supplies.

```ts
await client.configureProcessing({ automaticIFC: true, cpuCores: 1, memoryLimitMiB: 2048 });
const job = await client.prepareIFC(modelId);
console.log(await client.processing(modelId));
await client.cancelConversion(job.id);
```

The server drains the queue. Standalone Node programs opt into a background worker with `ModelsLibrary.open({root, xeoIFC, processingWorker: true})` and keep the library open. The default is no background worker for standalone catalog connections; blocking on-demand calls still process their own jobs. Short CLI commands enqueue work for a running server. [Settings, lifecycle and limits](processing.md).

Same-origin HTTP controls:

- `GET /api/processing?modelId=<optional UUID>`
- `PATCH /api/processing/settings`
- `POST /api/processing/models/:id/prepare`
- `POST /api/processing/jobs/:id/cancel`
- `POST /api/processing/jobs/:id/retry`

IFC preview APIs: `library.thumbnailStatus(id)` reports a ready flag and optional server-relative URL; `library.resolveThumbnail(id)` returns a verified PNG path, size and hash. `client.thumbnailStatus(id)` returns an absolute URL. Unprepared IFCs report no URL, keeping automatic preparation opt-in. A prepared IFC's missing thumbnail is generated from XGF through the shared queue. See [IFC thumbnails](processing.md#ifc-card-thumbnails).

## External IFC properties

See [external properties](external-properties.md) for `propertiesInfo`, `configureProperties`, `getPropertySets`, `getObjectProperties`, `queryPropertyObjects`, and `resolveDataModelFile`. The browser package also exports `ServerPropertiesClient` and `ExternalPropertyLoader`. All property data remains native xeokit SDK v3 data.
