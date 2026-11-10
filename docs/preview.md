# 3D previews

Choose **3D preview** on a library card. The modal retains your catalog selection
and scroll position. Drag to orbit, right-drag to pan, and scroll to zoom. **Fit
model** returns to the whole model; loading fits it automatically.

Each opening detects textures in the loaded model. Textured models start in
**PBR** with textures enabled; models without textures start in **Engineering**
with textures disabled. Edges, ambient occlusion and shadows start off every time,
regardless of the previous preview's settings. A stream switches to PBR when its
first textures arrive, unless you have already changed a rendering control.
**Ray trace** and **Path trace** are explicit choices and never open automatically,
even if the preceding preview used them. Texture, edge, ambient-occlusion and
shadow switches customize raster views. Tracing uses its own lighting and
material settings, so those raster switches are disabled while tracing.

The viewer tries WebGPU and falls back to WebGL when it is unavailable. Tracing
depends on the device and model: the SDK supports static triangle geometry with a
perspective camera. Unsupported geometry or a failed preparation returns to the
engineering view with an explanation. While navigating a traced view, raster
rendering keeps navigation responsive; tracing resumes after a short pause.
Path tracing uses the SDK's bounded preview preset (32 samples).

## Loading and cancellation

The viewer requests format discovery and resources through `ServerModelsClient`.
It prefers XGF. If either the original package or a cached XGF is at least 128
MiB and XGF Stream is offered, it prefers the stream. This is a size heuristic,
not a polygon-count estimate. Supported GLB/glTF representations remain fallback
choices when conversion fails. The original model is never modified.

The canvas shows preparation, download and parsing progress. Progress with an
unknown total is indeterminate; percentages apply to the current phase. Stream
progress describes the currently visible chunks, not the complete dataset.
**Cancel loading** aborts browser requests and releases the partially loaded
model. Closing does the same. A shared server conversion may finish and remain
cached for a later request.

Large models use the SDK's view-stream controller, with bounded concurrent
fetches and resident-chunk eviction. Selecting tracing pauses further streaming
and traces the currently loaded geometry. Returning to Engineering or PBR resumes
view-driven streaming. The stream's coordinate metadata supplies the initial fit
before chunks arrive.

## Resource ownership

After the catalog mounts, an idle task imports the separate viewer bundle and
initializes its renderer in an offscreen, unfocusable host. Catalog use does not
wait for that task. No models are fetched during warmup. An early preview joins
the same initialization, and an initialization failure can be retried.

The dialog moves the retained canvas into its visible host. Closing releases the
SceneModel, streaming requests, navigation activity and tracing acceleration
structures. The viewer, graphics device and canvas remain for the next opening.
Disposing the app also destroys those retained resources. Load generations and
serialized cleanup prevent stale requests from displaying a previous model.

The app controller, format selection, modal and SDK adapter are separate modules.
The Node library and browser API client do not import the renderer. The adapter
is built from actual SDK v3 source into `vendor/xeokit/preview`; ray/path modules
remain separate until selected. It is strictly checked against that SDK's types
when regenerated:

```sh
XEOKIT_SDK_PATH=/path/to/sdk-v3 npm run vendor:preview
npm run build
```

`npm run vendor:sdk` updates both the server converter and browser adapter.
Normal package builds use these pinned bundles and need no SDK checkout.

## Updating a running app

App builds retain previous hashed assets so an open tab can still load its viewer
and tracing modules after a rebuild. HTML and the browser API entry point are
served with cache revalidation. Reload to use a new app version. Do not delete
`build/app/assets` while the server is in use; remove old build output during a
planned stop when open sessions can be refreshed. Deployments to a separate
server should retain previous hashed assets in the same way.

The server allows `wasm-unsafe-eval` for the bundled viewer's WebAssembly decoders. JavaScript `unsafe-eval` stays disabled; script sources remain limited to this server. See the [CSP WebAssembly rule](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution).
