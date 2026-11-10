# Models as a scene geometry source

The existing conversion cache can supply geometry to xeokit scene resolvers.
This API does not create another geometry database or download an entire catalog.

```ts
import { ServerModelsClient } from '@xeokit/models/browser';
import { readXGFGeometryAssets } from '@xeokit/sdk/formats/xgf';
import { unwrapSDKResult } from '@xeokit/sdk/base/core';
const client = await ServerModelsClient.open('http://127.0.0.1:7420');
const references = await client.sceneAssets.references(modelId, { signal, maxReferences: 10000 });
const resolve = async (selected, writer) => {
  const shards = await client.sceneAssets.resolve(selected, {
    signal: writer.signal,
    maxBytes: writer.maxBytes,
  });
  for (const shard of shards) {
    const definitions = unwrapSDKResult(
      readXGFGeometryAssets(shard.bytes.buffer, shard.geometryIds),
    );
    shard.references.forEach((reference, index) => {
      const { id, ...params } = definitions[shard.geometryIds[index]];
      writer.write({ kind: 'geometry', reference, params, sourceBytes: shard.bytes });
    });
  }
};
```

Discovery prepares one model's `xgfstream` representation if needed and reads its
bounded readable index, which retains geometry IDs omitted from the compact runtime index. The namespace is `urn:xeokit:models:<library UUID>`. Identity contains
model UUID and geometry ID; revision and SHA-256 pin the containing XGF shard.
Variant is a validated relative package path, never a network address. Each batch
downloads a shared shard once, checks its hash, and returns the bytes without
retaining a decoded copy. The SDK reader creates no hidden SceneModel.

The converted-files HTTP endpoints and TypeScript clients remain the transport.
Deleting a model removes its conversions, so its references become unavailable.
Regeneration that changes bytes requires new references; no silent revision
substitution is made. Nested stream discovery requires selecting a child package.
The API does not publish independent immutable geometry revisions or promise
historical cache retention. Export embedded XGF for a portable snapshot.
