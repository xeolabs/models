# SDK conversions and cache lifetime

Models uses the actual xeokit SDK v3 `ModelConverter`, format loaders and exporters. This is a server feature; no browser, GPU, WebGL or WebGPU context is required. The original package always remains available. Automatic IFC preparation is opt-in in Processing settings. Otherwise conversion starts on demand.

## Choosing formats

Opening download options examines all mesh primitive types in an isolated Node child. For IFC this also prepares and caches XGF plus DataModel JSON in the same load. Later format discovery uses the saved options; later exports read the cached XGF and its exact semantic graph. It offers an output only when that exporter supports every primitive in the model. This is a compatibility check, not a guarantee of lossless conversion: compression extensions, texture encodings and unusual input details can still fail during export. Errors leave original packages intact and do not publish partial caches.

Configured input loaders: glTF/GLB, XGF, IFC, OBJ/MTL, PLY, STL, FBX, CityJSON, E57, LAS/LAZ and legacy XKT. Files such as RVT, NWD, STEP, Blender, Collada and 3D Tiles remain available as originals; they are not advertised for server conversion. Compressed inputs that require an additional decoder or external resource are not fetched automatically.

| Output                | Geometry and practical limitations                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLB                   | Triangles, lines and points; encoded textures and supported animation/morph data. Vertex-state geometry is excluded. Some SDK identifiers/metadata change.                                                                  |
| XGF                   | XGF v3 with authored coordinate information, SDK geometry, materials and supported animation data.                                                                                                                          |
| XGF Stream            | Runtime index plus spatial XGF chunks and shared assets. Preserves textures, morph geometry and vertex states; animation clips and authored variants are not exported. Models with procedural representations are excluded. |
| IFC                   | Triangle geometry reconstructed as IFC4; not a lossless authored BIM file.                                                                                                                                                  |
| OBJ + MTL             | Triangle geometry and material colors. The SDK exporter omits normals and UVs, so texture references are removed and this loss is reported.                                                                                 |
| PLY                   | Supported triangle or point geometry and vertex colors; object/material assignments flatten.                                                                                                                                |
| STL                   | Triangle geometry only, without units, colors or materials.                                                                                                                                                                 |
| FBX                   | Triangle geometry and supported material properties; texture images, shear, negative scales and coordinate metadata are not preserved.                                                                                      |
| CityJSON              | Triangle surfaces and supported properties.                                                                                                                                                                                 |
| DXF                   | Faces, lines and points, without texture materials or line styles.                                                                                                                                                          |
| E57                   | Point geometry and RGB in one scan; no original scan poses/intensity.                                                                                                                                                       |
| XKT                   | Legacy xeokit XKT v12 geometry and supported embedded metadata.                                                                                                                                                             |
| xeokit DataModel JSON | Object types, property sets and relationships from the source loader, without geometry. Available only when semantic objects exist.                                                                                         |

The source format is omitted from conversion choices because its original is already downloadable. glTF JSON sources can generate binary GLB. Unsupported mesh combinations are excluded. OBJ import itself has an SDK limitation: MTL colors are read, but texture maps are not imported. The interface reports this limitation.

Semantic data is available separately as **xeokit DataModel JSON** (`datamodel`), with entry point `model.datamodel.json`. The app downloads the JSON directly and provides a copyable DataModel URL. Availability follows the source loader: IFC and other loaders that populate a DataModel can offer this output. Sources with semantic objects but no supported geometry offer only their original and DataModel JSON. Geometry-only sources do not offer an empty DataModel.

Geometry conversions also retain semantic data as a DataModel JSON companion when present. That retains the source semantic graph, but it does not guarantee that exported geometry retains matching identifiers. Multiple output files are delivered together as a ZIP, with package-relative names. Single-file outputs download directly.

## XGF Stream over HTTP

The API format key is `xgfstream`; the app displays **XGF Stream**. The xeokit SDK
`XGFStreamExporter` creates both `index.runtime.json` (the entry point) and the
readable `index.json`, plus XGF files under `chunks/`. Models keeps the complete
SDK file map, including shared asset dependencies and coordinate information.
Semantic data is retained in `model.datamodel.json` when present.

The exporter uses spatial grid partitioning with a target of 500 objects per
chunk, local asset libraries covering 16 reference chunks and shared asset
shards of up to 512 assets. These are partitioning targets, not geometric LODs
or strict per-file size limits. A small model may need just one content chunk.

`client.entryUrl(id, {format: 'xgfstream'})` prepares the package on demand and
returns its HTTP runtime-index URL. Chunk URIs resolve relative to that URL;
every dependency is served by the same Models instance. Use xeokit SDK v3's
`readXGFStreamingRuntimeIndex` and streaming loader or view-stream controller
to consume it. HTTP supports byte ranges and configured cross-origin viewers.
The Model URL field uses a separate public file route that also supports viewers
without an origin allowlist; see [model links](model-links.md).
Serving one chunk verifies only that chunk, so the server does not reread the
whole dataset for every request. Missing or damaged chunks trigger regeneration of the complete package. Reload
the stream after recovery: SDK importers may assign fresh resource IDs. HTTP
responses use `no-store` to prevent mixing old browser-cached chunks with a
regenerated package.

Downloading from the app or CLI returns `model-xgfstream.zip`, containing the
same relative layout. Extract the complete ZIP to host it elsewhere. Stream
packages are generated outputs; native stream-directory import is not added.

## Cache ownership and deletion

```text
.cache/conversions/<model UUID>/<source-and-converter SHA-256>/
  options.json
  <format>/
    manifest.json
    model.<extension>
    ...optional companion files
```

The fingerprint includes original paths and content hashes, entry point, source format and the vendored converter revision. Renaming/tagging a model does not regenerate it. Identical active requests share a persistent job. PostgreSQL claims permit only one active worker across processes using this library. Foreground requests are selected before automatic jobs when the next worker starts. Full format requests verify every file size and SHA-256 hash; individual HTTP resource requests verify the requested file. Damaged/missing files regenerate on the next request.

A conversion is staged outside the cache using asynchronous copying and streaming SHA-256 verification. Only after successful export and validation are all files installed together by directory rename. Publication takes a short PostgreSQL model lock and rechecks the source record and cancellation state. Model deletion takes that same lock, aborts work owned by the local service, removes the entire model cache, then deletes the record. Work in another process cannot publish after deletion. A failed database deletion may discard a disposable cache while retaining the original model, which can regenerate later.

Old converter revisions stay within the model's directory until that model is deleted. Caches are not original assets and are not counted by original-asset GC or provider-download cache statistics. Provider transfer caches are independent. Interrupted processes may leave temporary staging files; no partial result is treated as complete. This version does not impose a total disk quota on all conversion caches.

## Execution bounds

The library queue runs one worker at a time. Defaults are one CPU core, low process priority, a 2048 MiB worker-memory limit, 1024 MiB of free-system-memory reserve, and a 60-minute deadline. Limits can be changed in Processing settings. Linux uses CPU affinity and checks process RSS (including WASM and buffers) every 250 ms. The RSS check is a watchdog, not an instantaneous OS memory reservation: brief overshoot remains possible. Other platforms retain low priority and the JavaScript heap limit; the UI reports the unavailable Linux controls. See [processing](processing.md).

Inputs and outputs are bounded to 3 GiB and 4096 files. These limits do not guarantee an IFC fits the worker's memory budget: parsing can require much more RAM than the source file. Portable ZIP limits remain smaller; HTTP file URLs avoid packaging large outputs. Originals remain available after failures.

Node's permission model limits worker reads to its staged package and converter, and writes to its temporary output directory. SDK fetches are restricted to embedded data URLs; remote resources are never acquired during conversion. Staging and cache paths reject symlinks and traversal. Conversion notices describe information that a target format cannot preserve.

## SDK provenance and rebuilding

`vendor/xeokit/provenance.json` records the SDK package version, source inputs and their combined SHA-256 revision. `vendor/xeokit/converter.cjs` is a readable, generated server bundle; the web-ifc WASM needed by the IFC exporter and its license notices ship with it. IFC input instead uses the separately configured XeoIFC runtime. Normal installation/building does not need an SDK checkout. The snapshot uses the supplied SDK v3 sources even though their package version is an alpha version.

To intentionally refresh it:

```sh
XEOKIT_SDK_PATH=/path/to/sdk-v3 npm run vendor:sdk
npm test
```

The adapter uses SDK sources including `src/conversion/pipeline/ModelConverter.ts`, `src/formats/ModelLoader.ts`, `src/formats/ModelExporter.ts`, each listed format's loader/exporter and encoders, `src/formats/xgfstream/XGFStreamExporter.ts`, `XGFStreamingExporter.ts` and runtime-index serializers, glTF resource loading, `src/model/scene/SceneTexture.ts`, and `src/formats/datamodel/DataModelExporter.ts`. Geometry eligibility was checked against Studio's SDK export compatibility logic. The supplied SDK glTF loader also retains separately referenced image bytes in headless mode; this path is covered by a real textured conversion test. The IFC input adapter uses the configured XeoIFC runtime; the IFC exporter resolves its separate web-ifc WASM beside the bundle.

PostgreSQL stores persistent processing jobs and settings without changing original assets or model identities. The derived cache can always be rebuilt from original assets. SDK, engine and pipeline changes invalidate affected cached outputs; existing files are not silently reused with a different conversion configuration.

IFC input is configured through [XeoIFC](ifc-providers.md). Engine diagnostics and source notices are retained; cache identity also includes the engine binaries and license configuration. `XeoIFCLoader.ts`, `XeoIFCLoaderOptions.ts` and `xeo/engine.ts`, `xeo/packed.ts`, `xeo/buildModel.ts` were inspected for this integration.
