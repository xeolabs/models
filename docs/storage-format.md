# Storage format

Schema 3 uses `PRAGMA user_version`, foreign keys, WAL, and a 5000 ms busy timeout. Future versions are rejected. An existing unrecognized database is not overwritten. Materials databases remain separate and unchanged.

| Table                                      | Purpose                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| library_info                               | Stable library UUID and creation time                           |
| models                                     | Stable model UUID, metadata, format and entry point             |
| assets                                     | Immutable SHA-256 file metadata                                 |
| model_files                                | Model-relative path to shared asset hash                        |
| tags / model_tags                          | Normalized catalog tags and relationships                       |
| model_search                               | FTS5 text index maintained with catalog mutations               |
| acquisition_plans / acquisition_plan_items | Immutable acquisition specifications                            |
| acquisition_jobs / acquisition_job_items   | Mutable execution and item state                                |
| model_acquisitions                         | Historical source, licenses and file hashes                     |
| processing_settings                        | Persistent opt-in and worker resource settings                  |
| processing_jobs                            | Durable conversion queue, ownership, cancellation and telemetry |
| provider_cache                             | Conditional HTTP metadata cache                                 |

Opening a version-1 catalog upgrades it transactionally to version 2. Original tables, assets, IDs and acquisition history remain unchanged. A partial unique index deduplicates active conversion jobs. Queue records are removed with their model. Future schema versions are rejected.

Assets live at `assets/sha256/ab/<64-character-hash>`. Extensions and relative layout belong to model file records, not binary identities. Imports validate every file first, install immutable files while holding the SQLite writer transaction, then commit metadata. Failed transactions may leave recoverable unreferenced immutable files; they never intentionally commit references to missing assets. GC holds the same writer transaction and never follows symlinks. Temporary staging and download cache are separate from permanent assets.

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

Schema 3 adds a model-owned property database registry. Existing records migrate with embedded properties. Version 1 upgrades through version 2 before this migration. Property databases live outside the conversion cache and are deleted with their model. See [external properties](external-properties.md) for the per-model schema and publication behavior.
