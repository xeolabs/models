# Models architecture

Models follows Materials: a Node.js server owns PostgreSQL, immutable SHA-256 files,
search, imports, and persistent acquisition plans and jobs. The Vue/Element Plus
app talks only to that server. Catalog records describe model packages, rather
than translating geometry into a new renderer data model. A package has an entry
file and relative dependencies; each file is deduplicated independently.

The acquisition engine, HTTP security, process ownership, cancellation, download
cache, ZIP validation and Studio-style app controls are adapted from Materials.
The model importer and file schema are separate from PBR materials.

## Provider evidence

Verified Poly Haven's official `/assets?type=models`, `/info/{id}` and `/files/{id}`.
Models have type 2. glTF file entries include an `include` dictionary keyed by
relative dependency path, alongside URL, size and MD5. Preserve those paths and
checksums. The official API terms require an identifiable client; assets are CC0.
Source: https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml
Terms: https://github.com/Poly-Haven/Public-API/blob/master/ToS.md

glTF URI semantics follow the Khronos 2.0 specification. Embedded data URIs remain
embedded. External references must be local, contained in the package and present.
Remote URLs, escaping paths and symlinks are rejected. No geometry conversion is
performed. IFC header validation checks the STEP envelope and IFC schema; it is
not a buildingSMART conformance or engineering validation.

## PostgreSQL persistence

Repositories await parameterized SQL through a bounded pool. Transaction ownership
is scoped to an asynchronous operation; nested repository calls share its client.
Catalog search uses a generated tsvector and GIN index. Published properties live
in shared model/revision-scoped tables. Native JSON text is preserved exactly,
including acquisition fingerprints and typed property values.

Files are prepared outside the catalog transaction. Named transaction locks
coordinate asset publication/GC, conversion admission, model publication/deletion,
and download-cache changes. PostgreSQL does not raise conversion concurrency.
See [migration specification](postgresql-migration.md) and
[operations](postgresql-operations.md).
