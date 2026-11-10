# External properties

IFC properties can stay on the Models server while geometry and the object graph
load into a viewer. This is optional. The default remains `embedded`, which writes
property values into DataModel JSON.

In **Processing → Processing settings**, choose the default property storage for
new IFC imports. The import dialog can override it. An IFC model's **Properties**
section can change its mode later. Changing a default does not change existing
models. Changing one model's mode schedules a cancellable processing job.

## Native xeokit representation

An external document keeps every `DataObject.propertySetIds` association. It has
`propertySetMode: "external"`, a `revisionId`, and no property values in its
`propertySets` array. Object IDs, names, types, hierarchy, and relationships remain
native xeokit data. A property response contains native `PropertySetParams` and
`PropertyParams`, without catalog metadata mixed into them.

The SDK keeps unresolved IDs separately from loaded `PropertySet` instances.
`createPropertySet()` attaches arriving values to waiting objects. Its ordinary
object-update events refresh consumers. `unloadPropertySets()` releases external
values while retaining references. Shared values remain alive while another model
owns them. Embedded models still reject missing property sets.

The SDK does no networking. Applications bind a model to its Models source and
revision. IDs are scoped by the Models catalog model ID in API requests; the SDK's
existing Data-wide identity and sharing rules still apply inside a viewer.

## Import and conversion

```ts
import { ModelsLibrary } from '@xeokit/models';

const library = await ModelsLibrary.open({ root: './my-models' });
try {
  const report = await library.importFile({
    path: './building.ifc',
    propertySetMode: 'external',
  });
  const modelId = report.model!.id;
  await library.getFormat(modelId, 'xgf');
  const info = await library.propertiesInfo(modelId);
  console.log(info.revision, info.propertySetCount);
} finally {
  await library.close();
}
```

`XeoIFCLoader.propertySetSink` awaits one object's property sets at a time. The
worker writes those definitions into its private SQLite staging file and retains
only the IDs in the DataModel. This avoids accumulating all property JSON and all
live property objects. The IFC engine's own geometry and parsing memory is still
subject to its existing worker limits.

An existing embedded IFC preparation can be moved to server storage by streaming
its cached DataModel JSON. The XGF is copied unchanged; IFC is not parsed again.
The upgrade also recognizes the previous converter's verified IFC cache generation.
A missing or damaged preparation must be regenerated from its original IFC.

Other geometry formats continue to use the cached XGF. Exporters that need property
values, such as IFC and CityJSON, explicitly load the stored values in their bounded
conversion worker. Their DataModel companion still uses external references.

## TypeScript clients

```ts
import { ServerModelsClient, ExternalPropertyLoader } from '@xeokit/models/browser';

const client = await ServerModelsClient.open('http://models.example:7420');
const info = await client.propertiesInfo(modelId);
if (!info.ready || !info.revision) throw new Error('Prepare the model first');

// The loaded DataModel already contains these references.
const sets = await client.getPropertySets(modelId, {
  revision: info.revision,
  ids: dataModel.objects[objectId].unresolvedPropertySetIds,
  signal: abortController.signal,
});

// Alternatively, bind the DataModel once and load selected objects on demand.
const properties = new ExternalPropertyLoader(client.properties, modelId, dataModel);
await properties.loadObject(objectId, abortController.signal);
// Release this binding when its model is unloaded from the viewer.
properties.dispose();
```

`getPropertySets()` batches requests, shares pending lookups, and returns each
requested ID once. Cancelling one caller leaves requests needed by others alive.
The cache defaults to 16 MiB and is keyed by model ID, revision, and property-set ID.
It holds private copies. `client.properties.clear(modelId)` releases a source's
cached values and pending requests.

The optional `ExternalPropertyLoader` keeps at most 32 MiB of values that it loaded
into the SDK. It evicts older sets before loading new ones and does not evict sets
being used by another active load. A selection that cannot fit fails explicitly;
callers can query its sets in smaller pages. Applications that attach values
manually own their corresponding SDK memory budget.

For larger work, consume bounded pages rather than accumulating all values:

```ts
for await (const sets of client.properties.iteratePropertySets(modelId, {
  revision,
  ids: propertySetIds,
  signal,
})) {
  // Consume this page before requesting the next one.
  processPropertySets(sets);
}
```

The iterator uses cached values, fetches missing values in bounded pages, and waits
for the consumer before fetching another page. It does not collect a whole model.

When only object IDs are known, `getObjectProperties(modelId, query)` returns their
property-set references, including empty objects and missing-object IDs. Follow its
cursor for objects with many references, then fetch the required sets.
`queryPropertyObjects()` performs indexed, typed scalar equality on the server and
returns matching object IDs with keyset pagination. For example:

```ts
const result = await client.queryPropertyObjects(modelId, {
  revision,
  propertyName: 'FireRating',
  value: '2h',
  propertySetName: 'Pset_WallCommon',
  limit: 100,
});
```

The Node `ModelsLibrary` provides the same query operations. Its `getPropertySets()`
returns a `PropertySetPage` with `nextCursor` and `missingIds`; the browser client
handles those pages automatically for ordinary batched lookups.

## HTTP and security

- `GET /api/models/:id/properties` reports mode, readiness, revision, and counts.
- `PATCH /api/models/:id/properties` selects a mode and schedules preparation.
- `POST /api/models/:id/property-sets/query` fetches a page of native sets by ID.
- `POST /api/models/:id/object-properties/query` fetches object-to-set references.
- `POST /api/models/:id/property-objects/query` finds objects by property value.
- `GET /api/models/:id/datamodel?properties=embedded&download=1` downloads a complete document.

The three POST queries are read-only. Configured viewer origins may call them, with
an explicit CORS preflight policy. This does not enable cross-origin PATCH or other
server mutations. Use the existing `--allow-origin` or `--allow-picker-origin`
configuration when serving Studio from another origin.

Responses use gzip or Brotli when the client supports it. Versioned responses carry
ETags; the TS client uses its own bounded revision cache. Each query checks the
current model registration before returning values. A stale revision produces
`PROPERTY_REVISION_MISMATCH` rather than mixing generations. An unprepared model
produces `PROPERTIES_NOT_READY`. Property database files have no public file route.

## Storage, recovery, and deletion

Catalog schema 3 adds `model_properties`, with a foreign key to `models`. Each
published generation lives at `properties/<model-uuid>/<revision>.db`, outside the
disposable conversion cache. Its tables are `info`, `property_sets`, `objects`,
`object_sets`, and `property_values`. Native JSON is retained per set. Separate
indexes serve ID lookup, associations, and scalar value queries.

The worker verifies its staged database before publication. The server installs the
immutable file and registers its revision in the conversion publication transaction.
A failed or cancelled job never registers a partial database. Interrupted staging
files may remain orphaned, but are never served. Old generations remain owned by the
model; they are removed when that model is deleted.

Deleting a library model cancels its processing, removes its registration, and
removes all of its property database files. Later startup cleans property folders
left by a crash after catalog deletion. Closing a preview or unloading from Studio
only releases client resources; it does not delete the library's properties.

## Offline exports and limits

The **Download full DataModel** action runs a separate queued job. It streams values
from SQLite into an embedded JSON document and caches the result. It does not change
the model's storage mode. The TS client exposes the URL through
`client.dataModelUrl(modelId, {propertySetMode: 'embedded', download: true})`.
Node applications use `library.resolveDataModelFile()` with the same mode option.

Current bounds are 128 IDs per HTTP request, 4 MiB per property set, approximately
8 MiB of property JSON per response, and 2048 association references per page. The
browser rejects responses larger than 9 MiB after decompression. Full exported
DataModel files retain the existing 3 GiB conversion-output limit. Property database
size is not limited by that file-export cap.

Nested values and large strings are preserved in native JSON. Indexed equality
queries support scalar values whose JSON encoding fits within 8192 characters;
arrays and objects are not indexed. Arbitrary SQL, property editing, live cross-server
replication, and automatic fetching by SDK getters are not part of this feature.

Studio binds properties when a model is imported through Models. A detached thin
JSON file has no embedded server URL; applications must configure its source. For
an offline workflow, use the complete export. Studio currently blocks merging
external-property models into one export, since a merged document has no single
source revision.
