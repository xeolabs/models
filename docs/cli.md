# CLI

Global options: `--library <root>`, `--database-schema <name>`, `--json`, `--version`, `--help`, `--user-agent <identity>`. Without `--library`, only the current directory is considered. JSON mode emits one stdout envelope; diagnostics remain on stderr.

```text
models init <root>
models migrate-postgres [--activate]
models serve [--port 7420] [--host 127.0.0.1] [--allow-origin <origin>]
models list [--limit 50] [--offset 0]
models search [text] [--format ifc] [--provider polyhaven] [--tags building,office]
models show <id>
models create --name <name>
models update <id> [--name <name>] [--description <text>]
models delete <id> --yes
models import <file> [--name <name>] [--tags <csv>] [--dry-run]
models import-directory <directory> --entrypoint <relative-file>
models import-manifest <manifest.json> [--dry-run]
models import-bundle <bundle.zip> [--dry-run]
models export <id> --output <bundle.zip>
models download-formats <id>
models convert <id> --format glb --output <download-path>
models convert <id> --format xgfstream --output ./model-stream.zip
models convert <id> --format datamodel --output ./model-data-download
models processing status [--model <id>]
models processing prepare <model-id>
models processing cancel <job-id>
models processing retry <job-id>
models processing settings [--automatic-ifc|--no-automatic-ifc] [--paused|--no-paused]
models processing settings --memory 2048 --reserve-memory 1024 --cpu-cores 1 --timeout 60
models tags
models tags add <id> <csv>
models tags remove <id> <csv>
models validate
models gc --dry-run
models gc --yes
models providers list
models remote search [query] [--provider all] [--limit 20]
models remote show polyhaven <remote-id>
models remote downloads polyhaven <remote-id>
models remote import polyhaven <remote-id> --resolution 1k
models remote plan create --query chair --resolution 1k --max-models 20 --max-bytes 2GiB
models remote plan list
models remote plan show <id>
models remote plan items <id>
models remote plan execute <id> --yes
models remote plan export <id> --output plan.json
models remote plan import plan.json
models remote job list
models remote job status <id>
models remote job resume <id> --yes
models remote job cancel <id>
models remote cache stats
models remote cache clear --yes
```

Use `--resolutions 1k,2k` or `--all-resolutions` instead of `--resolution` where supported. Formats are gltf, glb, fbx and blend. CLI help is the authoritative command option reference. Bulk execution and destructive actions require confirmation or `--yes`; GC previews by default. No command silently starts an existing job.

`datamodel` exports native xeokit DataModel JSON when semantic objects are present. Packages containing source notices are ZIPs; the app and HTTP file URLs also provide the JSON alone.

Converted downloads are generated only when requested and cached per model. `convert` reports the actual filename and notices; outputs with companion files are ZIP packages. Existing destination files are never overwritten. Deleting the model also deletes these caches.

## IFC collections

`--xeoifc-dir <directory>` configures the XeoIFC runtime for server and CLI conversions; `MODELS_XEOIFC_DIR` is the environment equivalent. Keep optional license keys in `MODELS_XEOIFC_LICENSE_KEY`, not command-line arguments.

```sh
models --library ./library remote search building --provider buildingsmart
models --library ./library remote search duplex --provider buildingsmart-community
models --library ./library remote plan create --provider buildingsmart --query building --resolution original --format ifc
models --library ./library --xeoifc-dir /opt/xeoifc serve
```

The usual inspect/execute/import commands work with these providers. See [IFC configuration](ifc-providers.md).

Processing settings persist in the library. Short queue commands do not run background workers themselves: leave `models serve` running to drain the queue. `convert` and `download-formats` still perform on-demand work. See [processing](processing.md).

## Property storage

```sh
models processing settings --properties external
models import ./building.ifc --properties external
models properties status MODEL_ID
models properties configure MODEL_ID --mode external
models properties sets MODEL_ID --revision REVISION --ids SET_ID,ANOTHER_SET_ID
```

The default applies to new imports only. Configuring an existing model queues a
storage conversion; the running server processes it. `--json` retains the normal
single-envelope output. Embedded and external are the two storage modes.

## PostgreSQL

Set `MODELS_DATABASE_URL` on the server or CLI process. Connection credentials never
belong in browser configuration. `--database-schema` selects the schema when creating
or migrating a library; subsequent opens use `postgres.json` in the asset root.

```sh
export MODELS_DATABASE_URL='postgresql://models@localhost/models'
models --library ./my-models --database-schema models migrate-postgres --activate
models --library ./my-models serve --port 7420
```

Stop writers before migration. It requires SQLite schema 3 and an absent PostgreSQL
schema, verifies copied values and constraints, and retains all source files. Without
`--activate`, it leaves the asset directory unbound for inspection. See
[PostgreSQL operations](postgresql-operations.md) before cutting over a live library.
