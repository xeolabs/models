# Use Models from Studio

The Models picker lets a Studio user browse the library, acquire a model, and explicitly send a selection back to the current Studio workspace. Studio stays open throughout. Acquisition jobs belong to the Models server and continue if the picker closes.

## Configure the server

Start the existing library with the exact Studio origin:

```sh
models --library "./my-models" serve --port 7420 \
  --allow-picker-origin http://localhost:5173
```

Repeat `--allow-picker-origin` for additional trusted Studio addresses. `localhost` and `127.0.0.1` are different origins. This option allows the picker to be embedded and allows catalog/model-file reads. It does not allow Studio to write to Models through cross-origin API calls. Library edits and acquisitions still run inside Models using its same-origin API.

Picker access is off by default. The existing `--allow-origin` option permits read-only API use without enabling embedding. API users can supply `pickerOrigins` to `startModelBrowser`.

In Studio, open **Settings → Connections**, enter the Models server address, choose **Test Models connection**, then check **Enable Models library in Studio**. The setting is saved in that browser and reverified on the next visit. An HTTPS Studio needs an HTTPS Models endpoint. Browsers may also ask for local network access.

## Choose or acquire a model

Use **File → Import → Models library**, or **File → Models library**. The picker shows models whose formats have Studio loaders. It retains the library's format, size, resolution and source information; unsupported formats are not converted.

Select a library record and click **Load in Studio**. For provider models, use **Find models**, review and execute an acquisition plan, then choose a completed model or resolution in the job panel. The first compatible result is selected initially; click **Load in Studio** to import it. Polling keeps your choice. Download completion never automatically loads a model into Studio.

**Open in separate tab** carries the current search, selected model and reviewed job or plan into a companion tab. Its **Return to Studio** action targets the opening Studio window. Browser focus restrictions may require selecting the Studio tab manually. A picker link opened without its Studio window cannot submit a selection.

Cancel leaves Studio's existing models, camera, layout and import draft intact. Loading uses Studio's existing importer and its normal progress, retry and replacement prompts. A library record changed since selection must be refreshed before loading.

## Integration contract

`@xeokit/models/browser` exports `ServerModelsClient`, the versioned picker protocol and URL/message helpers. `GET /api/picker` reports protocol version 1, library information and allowed picker origins. `/picker` serves the focused app interface.

A request has a random request ID, the exact caller origin, accepted format names and an initial theme. Both participants validate the origin, sending window, request ID and message shape. Selection contains a model UUID and its modification timestamp, never an arbitrary download URL. Studio rereads that record from its configured server, resolves package-relative file URLs, and acknowledges it before starting the import. Duplicate replies cannot import twice.

Catalog queries also accept a `formats` array through the TypeScript API or repeated `formats` URL parameters; filters and pagination are applied together in SQLite.

## Limits

The picker does not convert formats. Studio's current OBJ importer accepts one accompanying MTL file; packages with multiple MTL files need explicit selection through its ordinary importer. glTF packages retain relative buffer and texture URLs. A browser tab discarded by the browser still needs its ordinary Studio recovery; the picker does not add project persistence or authentication.
