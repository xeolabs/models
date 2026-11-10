# IFC discovery and conversion

In **Find models**, choose **buildingSMART Certification** or **buildingSMART Community**. Filter by **IFC**, inspect package sizes, select models and create/execute the usual acquisition plan. These providers supply an **ORIGINAL** variant; converted formats appear after acquisition in model details. Community discovery includes the reviewed Duplex, Clinic, Esplanades and SDK S1 collections. No provider account is needed.

```sh
models --library ./library remote search duplex --provider buildingsmart-community
models --library ./library remote import buildingsmart-community <remote-id> --resolution original
```

Source notices and CC BY 4.0 attribution are retained. Generated packages include those notices and a conversion notice identifying the change of format. The original IFC bytes are kept intact. See [verified provider details](provider-api-compatibility.md).

## Configure XeoIFC

IFC input uses the actual xeokit SDK v3 `XeoIFCLoader` registered as the converter's `xeoifc` input. It receives matching application-supplied `viewer_wasm.js` and `viewer_wasm_bg.wasm` files. There is no fallback to web-ifc for input. The separate SDK IFC **exporter** still uses its bundled web-ifc dependency to write IFC4 output.

```sh
export MODELS_XEOIFC_DIR=/absolute/path/to/xeoifc-runtime
# Optional, supplied securely by the administrator:
# export MODELS_XEOIFC_LICENSE_KEY=...
models --library ./library serve --port 7420
```

Alternatively use the global `--xeoifc-dir /absolute/path/to/xeoifc-runtime` option. The runtime directory is trusted server code, not a user upload. Upgrade the JavaScript and WASM together. The inspected SDK adapter expects the engine's `worker_load_*`/property API and IFCP v1 packed geometry, as documented in the SDK's `src/formats/ifc/README.md`. Arbitrary newer upstream binaries are not assumed compatible.

The repository does not redistribute the proprietary XeoIFC engine. The existing local demonstration runtime is evaluation-only and retains its watermark. Production deployment needs an appropriate engine license; xeokit and Models licenses do not grant that license. Missing or invalid runtime configuration leaves the original IFC available and gives an actionable conversion warning.

TypeScript configuration uses the same path:

```ts
import { ModelsLibrary } from '@xeokit/models';

const library = await ModelsLibrary.open({
  root: './library',
  xeoIFC: {
    runtimeDirectory: '/absolute/path/to/xeoifc-runtime',
    licenceKey: process.env.MODELS_XEOIFC_LICENSE_KEY,
  },
});
try {
  const acquisition = await library.acquisition();
  const found = await acquisition.search({
    providers: ['buildingsmart-community'],
    text: 'duplex',
  });
  console.log(found.items);
  // After acquiring a model, discover and request its supported formats:
  // const formats = await library.availableFormats(modelId);
  // const converted = await library.getFormat(modelId, 'xgf');
} finally {
  await library.close();
}
```

Conversion remains on demand in the existing permission-restricted child process. The engine loads local bytes, with no renderer, GPU or external resource fetch. Engine diagnostics remain visible in format warnings. IFC hierarchy and supported properties are preserved in the DataModel companion; output fidelity remains format-dependent. Original source data is not repaired. Models that yield no supported geometry fail explicitly.

Choose **xeokit DataModel JSON** in model details to download the semantic graph separately. Its `datamodel` API format provides `model.datamodel.json` and a copyable HTTP URL for `DataModelImporter`. Geometry conversions continue to include the same JSON as a companion.

Cache identities include source asset hashes, the SDK converter revision, engine JS/WASM bytes, license-key fingerprint and attribution. Engine or license changes therefore cannot reuse output from a different configuration. Deleting a model still deletes its cached formats. Public model URLs and XGF Stream manifests use the existing HTTP and TypeScript format APIs.

Standard tests exercise the real SDK adapter with a small engine test double, plus official provider metadata and an attributed IFC fixture. Setting `MODELS_XEOIFC_DIR` also enables a real-engine test that converts that building to GLB, XGF, XGF Stream and DataModel JSON; it needs no network.
