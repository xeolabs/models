# Models PostgreSQL migration

Status: implemented and verified on 11 November 2026. The local Models library now runs on PostgreSQL; the original SQLite files and a separate backup are retained.

## Objective

Make PostgreSQL the persistent database for Models, including the catalog, acquisition plans and jobs, processing settings and jobs, and published IFC properties. Preserve the HTTP and browser TypeScript contracts, UUIDs, property revisions, source hashes, plans, provenance and existing file URLs. Materials is outside this migration.

Original files, textures, thumbnails and converted XGF/other formats remain in the existing filesystem store. Moving the database must not reparse IFC or regenerate geometry. PostgreSQL does not replace conversion resource controls.

## Architecture

Use node-postgres with asynchronous repositories and a bounded connection pool. One database represents one Models library. Bind its stable library identity to the asset root; reject an unrelated root. Use versioned PostgreSQL migrations, parameterized SQL, explicit transaction ownership, and typed errors. Do not implement a synchronous SQL bridge or a second live catalog.

Each transaction uses one checked-out connection. Nested operations share that transaction; failed nested operations cannot accidentally commit. Replace SQLite-specific SQL deliberately. Batch catalog hydration instead of issuing several queries per displayed model. Store native JSON separately from indexed catalog fields. Preserve immutable acquisition plans and their fingerprints.

Replace FTS5 with a transactionally maintained tsvector/GIN index. Preserve all-term prefix matching, tag AND semantics, case-insensitive sorting and deterministic ID tie breaks. Test punctuation, Unicode, numbers and partial words.

## Properties

Use model/revision-scoped property_sets, property_objects, object_sets and property_values tables. Preserve native xeokit JSON, set identity, association order, scalar value types, empty objects and missing-ID distinctions. Keep existing response byte limits, cursors and revision validation.

Build new generations privately, upload in bounded batches, validate references/counts, then publish the revision in a short transaction that also checks model existence, storage mode, job ownership and cancellation. Never serve incomplete generations. Old or interrupted generations are reclaimable. Deleting a model makes its properties unavailable immediately and removes owned property data.

The converter may retain private SQLite staging files initially. Those are interchange artifacts, never the published property authority. Complete DataModel exports read PostgreSQL in bounded pages into worker staging; do not collect entire models in memory.

## Files and concurrent work

Stage and hash large files outside database transactions. Coordinate asset installation, references and GC explicitly; no committed record may refer to a missing file after an ordinary failure. Orphaned immutable files are recoverable. Model deletion and conversion publication share a model lock. Publication rechecks job ownership and cancellation after obtaining the lock.

Preserve the single conversion worker per library and existing CPU/RAM/time limits. Database row/advisory locks coordinate claims, cancellation and publication. Local process identity remains useful for recovery; multiple-host workers and automatic takeover of remote owners are outside this first release. PostgreSQL support alone does not make independent local asset roots interchangeable.

## Configuration and operations

Support a server-side database connection configuration through the Node API and environment/CLI. Never send database credentials to browsers or include them in errors. Keep the existing library root for assets and caches. Use small pools and bounded statements/lock waits. Run PostgreSQL with conservative resource limits on this system.

Document initialization, server startup, health checks, database and filesystem backups, restore and migration rollback. Do not silently initialize over SQLite or an unrelated PostgreSQL schema.

## Migration

1. Stop library writes and workers; retain a consistent SQLite backup and the original property databases.
2. Import the catalog into an empty PostgreSQL target, preserving IDs, timestamps, JSON and acquisition fingerprints.
3. Stream each registered property generation into PostgreSQL, preserving revision identifiers.
4. Verify counts, foreign keys, native property values, search, asset references and cached format access. Do not copy or regenerate large binaries.
5. Switch server configuration only after verification. Never resume interrupted conversions automatically.
6. Keep the SQLite source untouched for rollback. Rolling back after new PostgreSQL writes requires a deliberate reconciliation; it is not a bidirectional database mirror.

## Implementation and acceptance

Implement the async persistence foundation first, then catalog/search, acquisition and processing transactions, properties and worker interchange, migration/configuration, and documentation. Preserve behavior tests and add real PostgreSQL integration tests. Each test receives an isolated database/schema; tests never target the user's database.

Required checks: build, typecheck, lint, tests and package installation. Exercise rollback, concurrent claims/imports/GC, cancellation during publication, deletion during conversion, database outages, migration rejection/retry, and property pagination. Use resource-limited sequential validation; do not regenerate the large example datasets.

## References

- https://node-postgres.com/features/transactions
- https://www.postgresql.org/docs/16/mvcc-intro.html
- https://www.postgresql.org/docs/16/textsearch-indexes.html
- https://www.postgresql.org/docs/16/populate.html

## Acceptance record

- Build, typecheck and lint passed. The complete suite passed 170 tests, with three optional tests skipped.
- Installed-package verification passed for Node and browser imports, generated TypeScript declarations, CLI execution and real SDK conversions.
- The local migration preserved 19 model UUIDs, 88 assets, 99 file references, eight plans, six acquisition jobs, 40 processing-history records, 2,228 property sets and 247 property-bearing objects. Copied values and constraints were verified before activation.
- The live browser displayed all 19 models without page errors or changing desktop focus. HTTP checks passed for property queries, Studio-origin CORS, XGF byte ranges and thin DataModel JSON.
- The subsequent live XGF request exercised the existing on-demand preparation path for Duplex because its older cached fingerprint did not match the current converter configuration. The original migrated generation remains intact, and repeated reads used the new cache without scheduling more work. The migration itself did not regenerate model files.
- Source and database backups are retained under `.models/migration-backups/2026-11-11T00-03-16.318Z/`. The previous application source and launch configuration are retained alongside that directory.

PostgreSQL is authoritative for catalog records, jobs and published properties.
SQLite remains only for migration sources and private converter interchange.
See [operations](postgresql-operations.md) for deployment, backups and rollback.
