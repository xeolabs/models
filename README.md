# Models

A local model catalog with the same Vue, Element Plus and Dockview interface as Materials and Studio. Run the server on your computer or trusted network, import model packages, and give viewers stable HTTP URLs to their original files.

Existing SQLite libraries require the explicit [PostgreSQL migration](docs/postgresql-operations.md). Original files and cached conversions stay in place.

## Quick start

Requires **Node.js 22.16 or newer** and **PostgreSQL 16 or newer**. SQLite is used only to read legacy libraries and private converter staging files.

```sh
npm ci
npm run build
export MODELS_DATABASE_URL='postgresql://models@localhost/models'
node build/cli.js init ./my-models
node build/cli.js --library ./my-models serve --port 7420
```

Open **http://127.0.0.1:7420/**. Use **Import files** for a local file, a folder with dependencies, or an exported Models ZIP. Use **Find models** for provider search, thumbnail previews, immutable download plans and persistent jobs. Library panels support searching, filtering, editing names/descriptions/tags, package downloads and copying model URLs.

The app starts in **dark mode**. Use the sun/moon button in the header to switch to light mode. Your browser remembers the choice for this app, including future visits.

For LAN access, add `--host 0.0.0.0`. Use the machine's network address and port. This is a trusted-network application without built-in user accounts; use an authenticating reverse proxy when access control is required. The TypeScript server options support a public URL and explicit host names behind a proxy.

## Model packages

A catalog record has a stable UUID, separate metadata, an entry point and relative files. PostgreSQL owns metadata, tags, full-text search and acquisition history. Immutable original bytes live at `assets/sha256/<prefix>/<hash>` and are shared across packages. Imports preserve the original geometry, axes, units and material files. Optional downloads use xeokit SDK v3 to generate additional formats without modifying those originals.

Imports recognize glTF/GLB, IFC, OBJ/MTL, STL, PLY, LAS/LAZ, E57, FBX, Blender, STEP, DXF, Collada, CityJSON and explicit 3D Tiles documents. XKT, XGF, RVT and NWD are stored as opaque files with an explicit warning. Recognition checks file envelopes, not full geometry or specification conformance. glTF and OBJ dependencies are discovered; other external dependencies must be supplied in a manifest. See [formats and storage](docs/storage-format.md).

## 3D preview

Use **3D preview** on a library card to inspect a model without leaving the catalog.
The viewer warms up in the background, prefers XGF (or XGF Stream for large models),
fits the model automatically and shows cancellable loading progress. Models with
textures open in PBR with textures enabled; others open in Engineering without
textures. Edges, ambient occlusion and shadows start off each time. Ray tracing
and path tracing are explicit choices.
Closing unloads the model while retaining the viewer for the next preview.
See [preview controls and lifecycle](docs/preview.md).

## Model URLs

In **Model details**, select a **Model format** and copy the always-visible **Model URL**.
This serves the actual model file, or `index.runtime.json` for **XGF Stream**. The link
also serves relative textures, buffers and stream chunks. Copying a link does not
convert the model; its first load generates any needed conversion and later loads
reuse the cache. Deleting the model makes its links unavailable.

Anyone who can reach the server and has a model file URL can load it from their
application, including from another origin. Catalog management remains restricted.
For another device, run Models on the network and open the app using its network
address before copying. See [model links and xeokit loading](docs/model-links.md).

## Converted downloads

Select a library model and use **Download another format**. Models inspects its geometry with xeokit SDK v3 and lists compatible output formats. Read the notices, then choose **Generate and download**. For IFC, the first request prepares and caches XGF plus DataModel JSON. Other formats are then exported from that cached pair, without parsing IFC again. Other input formats retain their existing on-demand conversion path. Original package downloads remain available.

Conversions survive server restarts. Their cache includes the source hashes and SDK converter revision. Deleting a model removes all its cached conversions and prevents unfinished conversions from publishing afterward. Shared original files and other models' caches are preserved. Processing jobs and settings are persisted in PostgreSQL. Converted files remain disposable derivatives, not new catalog records.

IFC preparation also caches a thumbnail for the library card, using the already loaded geometry. Missing previews regenerate from XGF.

Open **Processing → Processing settings** to opt into automatic preparation of newly imported or acquired IFCs. The queue runs one low-priority worker, defaults to one CPU core and a 2 GiB memory limit on Linux, and shows phases, elapsed time, memory, CPU, errors, cancellation and retry. [Processing and resource limits](docs/processing.md).

For IFC and other sources with semantic objects, choose **xeokit DataModel JSON** to download object types, property sets and relationships without geometry. The JSON uses the native SDK format and can be loaded with `DataModelImporter`. Its copyable **DataModel URL** is served and cached like the geometry formats.

XGF Stream is also available: a complete chunked dataset, downloadable as a ZIP or loaded directly over HTTP with `client.entryUrl(id, {format: 'xgfstream'})`.

The Node and browser TypeScript APIs expose `availableFormats(id)`, `getFormat(id, format)` and individual file resolution. A viewer can request `client.entryUrl(id, {format: 'xgf'})` without unpacking a ZIP; see the [API examples](docs/api.md#discover-and-load-a-format).

See [conversion formats and limitations](docs/conversions.md), including format fidelity, size limits and the pinned SDK snapshot.

## Find models and compare sizes

Poly Haven and Smithsonian Open Access support direct CC0 model imports. buildingSMART Certification and curated buildingSMART Community collections support IFC imports with CC BY 4.0 credits. Sketchfab supports public discovery, previews and archive statistics. Open **Provider accounts** to verify and save a Sketchfab API token or OAuth access token. Models restores the saved account at startup and enables direct glTF archive imports for CC0 and CC BY 4.0 models. [Account configuration](docs/provider-accounts.md). Cards show provider polygon counts and package download ranges. Expand **download options** for the byte size and file count of each format/resolution combination. Sizes include all declared dependencies.

Filter by format, texture size, maximum package download in MiB, polygon count and tag. Smithsonian variant names describe provider quality, not texture pixel dimensions. Sort by name, smallest/largest download or fewest polygons; **Select matching** selects directly importable displayed results up to the model limit. Filters apply to the bounded search result set, currently up to 30 models. Changing criteria clears prior selection. Missing statistics are shown as unknown and do not pass numeric limits.

A texture resolution is not a geometric LOD. Each acquired resolution gets a separate model record. Package-size and polygon constraints are recorded in the immutable plan and checked again before acquisition. A global job transfer budget additionally counts retries; its default is 2 GiB.

Plans never download binaries. Explicit execution creates a separate job with bounded concurrency, retries, checksums, caching, cancellation and interruption recovery. Provider metadata and licensing are revalidated; changed files require a new plan. Download URLs are restricted to verified HTTPS hosts and public network addresses.

## TypeScript

```ts
import { ModelsLibrary } from '@xeokit/models';

// MODELS_DATABASE_URL is configured on the Node process.
const library = await ModelsLibrary.open({ root: './my-models', create: true });
try {
  const report = await library.importFile({
    path: './downloads/building.ifc',
    name: 'Office building',
    tags: ['building', 'ifc'],
  });
  const found = await library.search({ tags: ['building'], format: 'ifc' });
  console.log(report.model?.id, found);
} finally {
  await library.close();
}
```

Browser applications can use the renderer-independent client:

```ts
import { ServerModelsClient } from '@xeokit/models/browser';
const client = await ServerModelsClient.open('http://127.0.0.1:7420');
const page = await client.search({ format: 'gltf' });
if (page.items.length) console.log(await client.entryUrl(page.items[0].id));
```

For another origin, configure `serve --allow-origin http://localhost:5173`. Only catalog and model-file reads are allowed across that origin; mutations stay same-origin. glTF dependencies resolve relative to the served entry URL.

## CLI

```sh
models --library ./my-models import ./building.ifc --tags building,office
models --library ./my-models search office --format ifc
models --library ./my-models remote search armchair
models --library ./my-models remote import polyhaven ArmChair_01 --resolution 1k
models --library ./my-models export MODEL_ID --output ./building.zip
models --library ./my-models validate
models --library ./my-models gc --dry-run
```

Use the executable after installing the package, or prefix commands with `node build/cli.js`. See [CLI reference](docs/cli.md) and [API reference](docs/api.md).

## Maintenance and development

Deletion removes records, not shared binaries. GC defaults to a preview and coordinates with writers before removing unreferenced or interrupted-import files. Validation checks the PostgreSQL schema, foreign keys, metadata, paths and stored hashes without modifying the catalog. Back up PostgreSQL and the asset directory together while catalog writes and processing are stopped. See [PostgreSQL operations](docs/postgresql-operations.md).

```sh
npm run build
npm run typecheck
npm run lint
MODELS_TEST_DATABASE_URL='postgresql://models@localhost/models_test' npm test
MODELS_TEST_DATABASE_URL='postgresql://models@localhost/models_test' npm run test:package
```

Standard tests use isolated PostgreSQL schemas, temporary asset directories and mock provider transport. Set `MODELS_TEST_DATABASE_URL` to a disposable test server; each fixture creates and drops its own schema. The optional live test requires `MODELS_LIVE_TESTS=1` and downloads one small Poly Haven model. `npm run dev` serves Vite on 7421 and forwards API calls to the server on 7420.

IFC conversions use XeoIFC through xeokit SDK v3. Configure `MODELS_XEOIFC_DIR` (or `--xeoifc-dir`) with a matching, licensed runtime. [IFC setup and providers](docs/ifc-providers.md) explains configuration, attribution and testing.

## Current boundaries

- Providers: Poly Haven, Smithsonian Open Access, Sketchfab, buildingSMART Certification and buildingSMART Community. Sketchfab direct imports use the account saved in Provider accounts; Poly Haven and Smithsonian need no account. Material-only providers such as ambientCG are not represented as model providers.
- Catalog thumbnails use format tiles for local models and provider images for remote models. The optional 3D preview uses a separate, lazily loaded xeokit renderer; the Node library and browser API remain renderer independent. Server-side conversions use the supported xeokit SDK v3 loaders and exporters, with format-specific fidelity notices.
- Portable bundles and browser uploads retain the existing safe limits: 64 entries, 256 MiB per file, 512 MiB total. Provider downloads allow 256 MiB per file. Local API/CLI imports allow files up to 4 GiB; conversion packages remain limited to 3 GiB and larger originals can still be stored and downloaded; packages above portable limits cannot be exported as a ZIP.
- External HTTP dependencies, symlinks, implicit 3D Tiles templates, and OBJ map options are rejected. Nested tilesets and external FBX/Blender/Collada resources require explicit manifests; automatic traversal is limited as documented.
- No cloud publishing, dynamic provider plugins, automatic job resumption or geometry repair is included.

## Studio picker

Models can act as a library picker for Studio while Studio keeps its workspace open. Enable the exact Studio origin with `serve --allow-picker-origin http://localhost:5173`, then configure and enable Models in Studio's **Settings → Connections**. Users can select a local model or acquire one through **Find models** before choosing **Load in Studio**. [Setup, workflow and protocol](docs/studio-picker.md).

## Optional server-side properties

IFC imports can keep property values in Models while viewers load the object graph and request values on selection. Choose the default in Processing settings or override it per import. Embedded JSON remains the default. See [external properties](docs/external-properties.md) for the TypeScript API, storage, cancellation, and complete offline exports.

See [scene asset integration](docs/scene-assets.md) for shared resources, pinned
XGF references, trusted transport and lifetime rules.
