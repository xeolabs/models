# Storage format

PostgreSQL schema version 1 uses `schema_migrations`, enforced foreign keys, a
bounded connection pool and versioned initialization under an advisory lock.
Unrecognized or future schemas are rejected. `postgres.json` binds the local asset
directory to its library UUID and schema; it contains no connection credentials.
Existing SQLite versions are legacy migration sources, never live catalogs.

| Table                                      | Purpose                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| library_info                               | Stable library UUID and creation time                           |
| models                                     | Stable model UUID, metadata, format and entry point             |
| assets                                     | Immutable SHA-256 file metadata                                 |
| model_files                                | Model-relative path to shared asset hash                        |
| tags / model_tags                          | Normalized catalog tags and relationships                       |
| model_search                               | PostgreSQL tsvector/GIN index maintained with catalog mutations |
| acquisition_plans / acquisition_plan_items | Immutable acquisition specifications                            |
| acquisition_jobs / acquisition_job_items   | Mutable execution and item state                                |
| model_acquisitions                         | Historical source, licenses and file hashes                     |
| processing_settings                        | Persistent opt-in and worker resource settings                  |
| processing_jobs                            | Durable conversion queue, ownership, cancellation and telemetry |
| provider_cache                             | Conditional HTTP metadata cache                                 |

The explicit SQLite migration accepts legacy schema 3 and copies records into an empty PostgreSQL schema in one transaction. Original files, IDs and acquisition history remain unchanged. A partial unique index deduplicates active conversion jobs. Queue records are removed with their model. Future schema versions are rejected.

Assets live at `assets/sha256/ab/<64-character-hash>`. Extensions and relative layout belong to model file records, not binary identities. Imports validate and stage files asynchronously, then install immutable files and commit metadata under a PostgreSQL asset publication lock. Failed transactions may leave recoverable unreferenced immutable files; they never intentionally commit references to missing assets. GC takes the same transaction-scoped asset lock and never follows symlinks. Temporary staging and download cache are separate from permanent assets.

A portable ZIP contains `manifest.json` and the original package-relative files:

```json
{
  "schemaVersion": 1,
  "metadata": { "name": "Example", "tags": ["demo"], "source": {} },
  "entrypoint": "scene.gltf",
  "files": [{ "path": "scene.gltf" }, { "path": "mesh.bin" }]
}
```

Exports add SHA-256 to each file and preserve the original model UUID as provenance. Reimport assigns a new UUID. Absolute paths, `..`, symlinks, duplicate/case-conflicting names and missing declared dependencies are rejected. `manifest.json` is reserved. ZIPs have 64-entry, 256-MiB-entry and 512-MiB-total limits on actual expanded bytes. The writer uses streaming files and refuses packages that exceed the reader limits.

Format checks identify headers/envelopes and preserve source bytes. IFC/STEP check Part 21 header/end markers; this is not schema validation. glTF/GLB follow declared local buffers/images. OBJ follows basic MTL texture references. Other multi-file formats should use a manifest listing every dependency. CityJSON and explicit top-level 3D Tiles JSON are recognized; implicit templates are rejected. Nested tileset external resources are not recursively discovered. XKT/XGF/RVT/NWD remain opaque with warnings. Import recognition does not guarantee conversion support; discover supported outputs through the conversion API.

PostgreSQL stores property generations in `property_generations`, `property_sets`,
`property_objects`, `object_sets` and `property_values`. Every key includes the model
and revision. Only a complete registered generation is served. Deleting a model
cascades through these tables. Private SQLite worker files remain an interchange
format; legacy published `.db` files are retained solely for migration rollback.
