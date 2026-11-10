
/**
 * Plans, jobs and provenance share the model catalog and its transaction boundary.
 */
export const acquisitionMigration = `
CREATE TABLE acquisition_plans (
 id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL CHECK(schema_version=1),
 created_at TEXT NOT NULL, expires_at TEXT, criteria_json TEXT NOT NULL,
 summary_json TEXT NOT NULL, fingerprint TEXT NOT NULL, warnings_json TEXT NOT NULL
);
CREATE TABLE acquisition_plan_items (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES acquisition_plans(id) ON DELETE CASCADE,
 ordinal INTEGER NOT NULL, provider TEXT NOT NULL, remote_asset_id TEXT NOT NULL,
 model_name TEXT NOT NULL, resolution TEXT NOT NULL, format TEXT NOT NULL,
 manifest_json TEXT NOT NULL, UNIQUE(plan_id,ordinal), UNIQUE(plan_id,provider,remote_asset_id,resolution)
);
CREATE TRIGGER immutable_plans BEFORE UPDATE ON acquisition_plans BEGIN SELECT RAISE(ABORT,'Acquisition plans are immutable'); END;
CREATE TRIGGER immutable_plan_items BEFORE UPDATE ON acquisition_plan_items BEGIN SELECT RAISE(ABORT,'Acquisition plan items are immutable'); END;
CREATE INDEX plans_created ON acquisition_plans(created_at,id);
CREATE INDEX plans_fingerprint ON acquisition_plans(fingerprint);
CREATE TABLE acquisition_jobs (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES acquisition_plans(id),
 status TEXT NOT NULL CHECK(status IN ('pending','running','completed','completed_with_errors','failed','cancelled','interrupted')),
 created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 downloaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(downloaded_bytes>=0),
 options_json TEXT NOT NULL, owner_json TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX jobs_created ON acquisition_jobs(created_at,id);
CREATE TABLE acquisition_job_items (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES acquisition_jobs(id) ON DELETE CASCADE,
 plan_item_id TEXT NOT NULL REFERENCES acquisition_plan_items(id),
 status TEXT NOT NULL CHECK(status IN ('pending','downloading','validating','importing','completed','skipped','failed','stale','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, downloaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(downloaded_bytes>=0),
 model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
 error_code TEXT,error_message TEXT,started_at TEXT,completed_at TEXT,warnings_json TEXT NOT NULL DEFAULT '[]',
 UNIQUE(job_id,plan_item_id)
);
CREATE INDEX job_items_status ON acquisition_job_items(job_id,status);
CREATE TABLE model_acquisitions (
 id TEXT PRIMARY KEY, model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
 job_item_id TEXT NOT NULL UNIQUE REFERENCES acquisition_job_items(id),
 provider TEXT NOT NULL,remote_asset_id TEXT NOT NULL,resolution TEXT NOT NULL,format TEXT NOT NULL,
 source_url TEXT NOT NULL,license_json TEXT NOT NULL,author TEXT,acquired_at TEXT NOT NULL,
 manifest_fingerprint TEXT NOT NULL,file_hashes_json TEXT NOT NULL,metadata_json TEXT NOT NULL
);
CREATE INDEX acquisitions_remote ON model_acquisitions(provider,remote_asset_id,resolution,format,acquired_at);
CREATE TABLE provider_cache (
 key TEXT PRIMARY KEY,value_json TEXT NOT NULL,stored_at INTEGER NOT NULL,etag TEXT,last_modified TEXT
);

`;
