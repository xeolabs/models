# PostgreSQL operations

Models requires PostgreSQL 16 or newer with ICU support (included in standard Ubuntu PostgreSQL packages). The browser still connects only to Models;
it never receives database credentials. Each library owns a schema and a local
asset directory. Prefer one database per deployed library. Tests use separate schemas.

## Configure and initialize

Create a UTF-8 database and a role allowed to create and own its Models schema using your
normal PostgreSQL administration tools. Configure the server environment:

```sh
export MODELS_DATABASE_URL='postgresql://models@localhost/models'
models init ./my-models
models --library ./my-models serve --port 7420
```

Use PostgreSQL's password-file or secret-management facilities when a password is
needed. Do not put a production password in a command committed to source control.
`--database-schema <name>` selects a schema at initialization/migration. Normal
opens read the schema and stable library identity from `postgres.json` in the asset
root. Changing that file to an unrelated database is rejected by identity checks.

The Node API accepts `database: {connectionString, schema, maxConnections}` in
`ModelsLibrary.open`. Pool size defaults to five, with five-second connection and
lock waits and a thirty-second statement limit. Conversion CPU/RAM limits and the
single-worker limit remain separate from the database pool. A schema-owned ICU collation keeps Unicode search and case folding consistent even when the database was initialized with the C locale.

## Migrate an existing library

Stop the Models server and other writers/processing clients first. Take a consistent
backup of `models.db`, its WAL if present, registered property files and the asset
root. The migration reads one SQLite snapshot and rejects running jobs. It cannot
prevent an unrelated old application from writing afterward; stopping writers is
required for a valid cutover.

```sh
export MODELS_DATABASE_URL='postgresql://models@localhost/models'
models --library ./my-models --database-schema models migrate-postgres --activate
models --library ./my-models serve --port 7420
```

Migration requires legacy SQLite schema 3 and an absent destination schema. It copies
catalog records and published properties, verifies returned values and counts, checks
constraints and rebuilds search. The destination schema and rows commit together.
A failed database import leaves no partial target. Omit `--activate` to create a
reviewable database copy without changing the library binding. Activation writes
only `postgres.json`; existing SQLite files remain untouched. If binding-file creation
fails after a successful database commit, inspect the reported target rather than
rerunning against a nonempty schema.

Migration never copies or reconverts original geometry, cached XGF, streams or
textures. Keep the asset directory at the existing location. Plans, source hashes,
model UUIDs, property revisions and URLs retain their identities.

## Backup and restore

Pause writes and processing, take a PostgreSQL backup with `pg_dump`, and back up
assets plus `postgres.json` and server configuration. Converted files and download
cache are regenerable but retaining them avoids expensive IFC work. Restore the
matching database and asset snapshot together, then validate Models before accepting
writes. Credentials and provider tokens are server configuration, not model bundles.

The retained SQLite source is a rollback snapshot. After new writes to PostgreSQL,
returning to SQLite requires reconciliation; there is no automatic bidirectional sync.

## Validation and resource use

`models validate` checks the registered schema, records and asset hashes. PostgreSQL
itself maintains foreign keys; database health and backup verification also belong
to PostgreSQL operations. GC takes the same asset lock as publication. It does not
remove source SQLite backups automatically.

Keep PostgreSQL memory and connection settings conservative. A large amount of
available RAM does not mean conversion concurrency should be increased. The initial
migration preserves one conversion worker and does not introduce distributed workers.

For tests, set `MODELS_TEST_DATABASE_URL` to a disposable PostgreSQL database. Test
fixtures create unique `test_*` schemas and remove them on completion. They must never
point at a production library schema. Provider tests remain offline.

## Local development deployment

This workspace uses the `xeokit-models-postgres.service` user service. Its data,
private socket and unpacked PostgreSQL 16 runtime are under `.models/.postgres/`.
The server listens on the private Unix socket only; Models connects as the restricted
`models` role using peer authentication. The database is not exposed to the LAN.
PostgreSQL is capped at one CPU and 1 GiB of memory, with 128 MiB of shared buffers.

The `xeokit-models.service` user service runs the app on port 7420 and starts after
PostgreSQL. Both are enabled for the user's service manager. They start with the user
session; boot without login requires a separate administrator decision about lingering.

```sh
systemctl --user status xeokit-models-postgres xeokit-models
journalctl --user -u xeokit-models-postgres -u xeokit-models -n 80
systemctl --user restart xeokit-models
```

The runtime was unpacked from Ubuntu PostgreSQL packages because administrator
installation was unavailable. It is not automatically maintained by the system
package manager. Apply PostgreSQL minor security updates deliberately, stopping the
services and retaining backups; replacing this with an administrator-managed service
is also supported through `MODELS_DATABASE_URL`.

Text search now uses PostgreSQL tokenization. All-term prefix searches and tag AND
filters remain available, with explicit Unicode case folding. Punctuation and accents
can tokenize differently from the former FTS5 index.
