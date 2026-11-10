# Load a model from its URL

Select a model in the library, choose its format in Model details, then copy
**Model URL**. The field updates immediately when you change formats. It remains
selectable when the browser does not allow clipboard access over HTTP.

The URL points to a file, not a ZIP download or a JSON API envelope. For XGF
Stream it points to `index.runtime.json`; relative chunk URLs stay beneath the
same model and format. Original glTF paths, buffers and textures keep their
package layout. Download buttons still produce portable files or packages.

Showing or copying the URL does not generate a conversion. The first load does,
and later requests reuse the verified cache. Links remain stable across server
restarts and metadata edits. They stop working when the model is deleted.

## Load DataModel JSON with xeokit SDK v3

Choose **xeokit DataModel JSON** and copy **DataModel URL**. The link ends in
`/models/MODEL_UUID/formats/datamodel/files/model.datamodel.json`. It provides
object types, property sets and relationships, without geometry. The app's
**Download JSON** button saves this file directly. Availability depends on the
source loader providing semantic objects; IFC uses the configured XeoIFC runtime.

With an existing, empty SDK `dataModel`:

```ts
import { unwrapSDKResult } from '@xeokit/sdk/base/core';
import { DataModelImporter } from '@xeokit/sdk/formats/datamodel';

const url =
  'http://192.168.1.10:7420/models/MODEL_UUID/formats/datamodel/files/model.datamodel.json';
const response = await fetch(url);
if (!response.ok) throw new Error(`DataModel: HTTP ${response.status}`);
const importer = new DataModelImporter();
unwrapSDKResult(await importer.load({ dataModel, fileData: await response.json() }));
```

Append `?download=1` when a download attachment is wanted instead of an inline
JSON response. Source credits remain in the full conversion package and catalog.

## Network access

Anyone who can reach the server and knows a model file URL can read it. Shared
file routes allow any browser origin, without cookies or credentials. They do
not grant access to catalog listings, editing, acquisition jobs or private cache
files. The existing API and Studio picker still use their configured allowlists.

To serve other devices on a trusted network:

```sh
models --library ./my-models serve --host 0.0.0.0 --port 7420
```

Open the app at the server's network address before copying, for example
`http://192.168.1.10:7420`. A link containing `localhost` or `127.0.0.1` points to
the receiving device itself. An HTTPS viewer needs an HTTPS Models URL; use an
HTTPS reverse proxy for that deployment. Browser local-network policies and
network firewalls still apply. The URL does not bypass reverse-proxy authentication.

## Load XGF Stream with xeokit SDK v3

The SDK class is `XGFStreamingLoader`. It consumes decoded manifests; first fetch
and decode the copied runtime index, then resolve chunk URIs against its URL.
With an existing, empty streaming `sceneModel`:

```ts
import { unwrapSDKResult } from '@xeokit/sdk/base/core';
import { readXGFStreamingRuntimeIndex, XGFStreamingLoader } from '@xeokit/sdk/formats/xgfstream';

const url = 'http://192.168.1.10:7420/models/MODEL_UUID/formats/xgfstream/files/index.runtime.json';
const controller = new AbortController();
const response = await fetch(url, { signal: controller.signal });
if (!response.ok) throw new Error(`Model index: HTTP ${response.status}`);
const index = unwrapSDKResult(readXGFStreamingRuntimeIndex(await response.json()));
const loader = new XGFStreamingLoader();

unwrapSDKResult(
  await loader.loadChunks(
    { sceneModel, manifests: index.chunks },
    {
      manifests: index.chunks,
      coordinateSystem: index.coordinateSystem,
      signal: controller.signal,
      fetchConcurrency: 2,
      getFileData: async (chunk, signal) => {
        const file = await fetch(new URL(chunk.uri!, url), { signal });
        if (!file.ok) throw new Error(`Model chunk: HTTP ${file.status}`);
        return file.arrayBuffer();
      },
    },
  ),
);
```

This example loads the complete stream. For large models, use the SDK's
`XGFViewStreamController` to select chunks based on the view. Pass the decoded
index, `streamIndexBaseURI: url`, and the same chunk-fetch function in its
`loadOptions`. Models serves the complete chunk graph, including asset libraries.

GET and HEAD work on the manifest and every file. Range requests return partial
bytes and expose `Content-Range`, `Content-Length` and `Accept-Ranges` to viewers.
A missing model or file returns 404. Conversion failures return a structured
error and do not publish a partial model.
