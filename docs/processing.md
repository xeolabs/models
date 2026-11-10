# IFC preparation and conversion jobs

IFC can take much longer to parse than the files generated from it. Models prepares each IFC as XGF v3 plus `model.datamodel.json`, verifies the pair and caches it. A later XGF request serves that file. Other generated formats load the cached XGF with the exact cached DataModel, so the IFC engine does not run again. Preparation also renders and caches the library-card thumbnail from the geometry already loaded. Original IFC downloads always serve the original bytes.

The first format-discovery request also prepares this pair instead of doing a costly inspection that would need repeating. Simultaneous requests share one job. Cache corruption, a source change, or an SDK/engine/pipeline revision can require preparation again. Different formats retain their own verified caches.

## Automatic preparation

Open **Processing → Processing settings**, enable **Automatically prepare new IFC models**, then save. It is off by default. Newly imported or provider-acquired IFCs are queued in the same transaction that commits the original model and acquisition completion marker. Dry runs and failed imports do not schedule work. Downloads do not wait for conversion to finish.

The server checks for queued work every half second. Existing IFCs are not all queued when this option is enabled; use **Prepare IFC** in model details for an existing model, or request a format normally. Turning automatic preparation off stops automatic queued jobs from starting; it does not cancel the current worker. A direct user request promotes an automatic job to requested work.

## Queue and controls

**Processing** in the header shows the active count. Its dialog shows the latest 100 jobs, model names, stage, elapsed time, last measured memory and CPU, and errors. Aggregate counts include the complete history. Stages are actual processing events, not estimated completion percentages; some IFC engine calls cannot report progress until they return.

**Pause queue** stops new jobs, including on-demand jobs, from starting. The current worker continues. **Cancel** cancels queued work immediately and asks an active owner to stop; the owner checks persistent cancellation every 250 ms and terminates its SDK child. File staging is asynchronous and may finish its current filesystem operation before cancellation completes. No partial output is published. A fully completed cache remains usable even if a later export is cancelled.

**Retry** creates a new job for failed, cancelled or interrupted work. Completed cache stages are reused. Cancelling a preparation also fails requests waiting for that preparation. Opening the model or requesting a format again is a fresh request and can schedule new work.

A heartbeat indicates that the worker's owning server is alive; it is not proof that a particular IFC engine step is progressing. CPU and memory help distinguish active computation from a stalled operation. The time limit terminates operations that do not finish.

## Resource limits

| Setting       | Default       | Meaning                                                                               |
| ------------- | ------------- | ------------------------------------------------------------------------------------- |
| Workers       | 1 per library | Shared across server processes by SQLite claims                                       |
| CPU cores     | 1             | Linux CPU affinity, configurable from 1 to 4 available CPUs                           |
| Priority      | Low           | Other local work takes priority                                                       |
| Worker memory | 2048 MiB      | Linux RSS watchdog, including WASM and native buffers                                 |
| Keep free     | 1024 MiB      | Defer starting jobs below this threshold; stop a worker if free memory falls below it |
| Time limit    | 60 minutes    | Wall-clock limit per SDK worker                                                       |

User-requested work runs before automatic jobs when selecting the next job. Running jobs are not preempted. Settings apply to the next worker. The memory watchdog samples every 250 ms and may briefly overshoot; it is not an OS memory reservation. JavaScript also has a heap limit set to 75% of the worker-memory setting. Linux requires `taskset` and `getconf` on the server's PATH. If CPU affinity cannot be established, the job fails instead of running unconstrained.

On other platforms, process priority, single-worker scheduling, timeout and the JavaScript heap limit remain. Total RSS monitoring and CPU affinity are not provided there; the dialog reports this limitation. For a strict whole-service RAM/CPU ceiling, run Models under operating-system or container resource controls as well.

Copies and SHA-256 checks use asynchronous I/O outside long SQLite transactions. Input and output packages are bounded to 3 GiB and 4096 files. The worker fills binary input buffers using chunked reads, so Node's 2 GiB whole-file read limit does not block larger inputs. Generated DataModel JSON is written and reloaded incrementally to avoid JavaScript single-string limits. SDK loaders still require the complete input in memory; large IFC files can require far more RAM than their disk size. Portable ZIP and provider-download size limits are unchanged; a large generated file can be served directly over HTTP even when it cannot be packaged in a portable ZIP.

## Persistence and recovery

Schema version 2 adds `processing_settings` and `processing_jobs` without changing original assets or material/model semantics. Active-job uniqueness prevents duplicate scheduling. Claims use a writer transaction and a process identity including PID, process start, host and boot identity. A stale heartbeat alone never authorizes stealing a job from another live process.

Queued jobs survive restarts. Closing the server stops its own worker and marks the job interrupted. An abruptly terminated owner is detected on the next claim; its job is marked interrupted for explicit retry. The child exits when its parent disconnects. Recovery does not automatically repeat a failed or interrupted massive conversion. Deleting a model removes its jobs and caches and prevents a late result from being published. A crash can leave temporary staging files; they are never considered complete caches.

The Models server drains the queue. Standalone Node clients default to processing only their own blocking requests. To run a background worker without the app, open a library with `processingWorker: true`, provide its XeoIFC runtime, and keep the process and library open. Short CLI settings/status/scheduling commands do not claim background work.

## IFC card thumbnails

Preparation produces a 384 × 288 PNG using a small CPU depth-buffer renderer. It uses model colors, flat lighting and an automatic three-quarter view. There is no browser/GPU startup, texture decoding or additional IFC parse. Rasterization is bounded to 1.5 million triangles and a ten-second budget; unusually large models may have a simplified preview. This is an engineering thumbnail, not a PBR render.

The preview lives beside the conversion cache in its own `preview/` directory. It is hashed independently, so a corrupt or missing thumbnail can be regenerated from cached XGF without invalidating geometry or reloading IFC. The library card updates when preparation completes and uses the app's normal loading spinner.

Simply browsing unprepared IFC cards does not secretly enable automatic IFC conversion. Those cards show the IFC placeholder until the model is prepared on demand or by the opt-in background setting. Existing prepared models can generate a missing thumbnail from XGF on the first thumbnail request. Deleting the model deletes its preview as well.

`GET /api/models/:id/thumbnail/status` reports `{ready,url?}` without loading IFC; `GET /api/models/:id/thumbnail` serves a verified PNG or regenerates a missing preview from cached XGF through the same bounded queue. Node offers `thumbnailStatus(id)` and `resolveThumbnail(id)`, and the browser client offers `thumbnailStatus(id)` with an absolute URL.
