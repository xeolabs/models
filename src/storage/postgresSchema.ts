
/**
 * PostgreSQL schema version one. Native JSON text preserves plan fingerprints
 * and property values; indexed columns support catalog and property queries.
 */
export const postgresSchema = `
CREATE COLLATION catalog_text (provider=icu, locale='und', deterministic=true);
CREATE TABLE library_info(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
CREATE TABLE models(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,source_json TEXT NOT NULL,entrypoint TEXT,format TEXT,warnings_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE assets(id TEXT PRIMARY KEY,bytes BIGINT NOT NULL CHECK(bytes>=0),mime TEXT NOT NULL,original_filename TEXT NOT NULL,imported_at TEXT NOT NULL);
CREATE TABLE model_files(model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,path TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES assets(id),PRIMARY KEY(model_id,path));
CREATE INDEX files_asset ON model_files(asset_id);
CREATE TABLE tags(name TEXT PRIMARY KEY);
CREATE TABLE model_tags(model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,tag TEXT NOT NULL REFERENCES tags(name),PRIMARY KEY(model_id,tag));
CREATE INDEX models_name ON models(name,id);
CREATE INDEX models_format ON models(format,id);
CREATE TABLE model_search(id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL,tags TEXT NOT NULL,provider TEXT NOT NULL,format TEXT NOT NULL,
 document tsvector GENERATED ALWAYS AS (to_tsvector('simple',lower((name || ' ' || description || ' ' || tags || ' ' || provider || ' ' || format) COLLATE catalog_text))) STORED);
CREATE INDEX model_search_document ON model_search USING GIN(document);

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


CREATE INDEX plans_created ON acquisition_plans(created_at,id);
CREATE INDEX plans_fingerprint ON acquisition_plans(fingerprint);
CREATE TABLE acquisition_jobs (
 id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES acquisition_plans(id),
 status TEXT NOT NULL CHECK(status IN ('pending','running','completed','completed_with_errors','failed','cancelled','interrupted')),
 created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 downloaded_bytes BIGINT NOT NULL DEFAULT 0 CHECK(downloaded_bytes>=0),
 options_json TEXT NOT NULL, owner_json TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX jobs_created ON acquisition_jobs(created_at,id);
CREATE TABLE acquisition_job_items (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES acquisition_jobs(id) ON DELETE CASCADE,
 plan_item_id TEXT NOT NULL REFERENCES acquisition_plan_items(id),
 status TEXT NOT NULL CHECK(status IN ('pending','downloading','validating','importing','completed','skipped','failed','stale','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0, downloaded_bytes BIGINT NOT NULL DEFAULT 0 CHECK(downloaded_bytes>=0),
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
 key TEXT PRIMARY KEY,value_json TEXT NOT NULL,stored_at BIGINT NOT NULL,etag TEXT,last_modified TEXT
);




CREATE TABLE processing_settings(id INTEGER PRIMARY KEY CHECK(id=1),settings_json TEXT NOT NULL);
INSERT INTO processing_settings VALUES(1,'{"automaticIFC":false,"paused":false,"memoryLimitMiB":2048,"reserveMemoryMiB":1024,"cpuCores":1,"timeoutMinutes":60}');
CREATE TABLE processing_jobs(
 id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, format TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL,
 phase TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 heartbeat_at TEXT, memory_bytes BIGINT, cpu_percent DOUBLE PRECISION,
 owner_json TEXT, error_code TEXT, error_message TEXT
);
CREATE UNIQUE INDEX processing_active ON processing_jobs(model_id,kind,format)
 WHERE status IN ('queued','running','cancelling');
CREATE INDEX processing_status ON processing_jobs(status,source,created_at,id);


CREATE TABLE model_properties (
 model_id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
 mode TEXT NOT NULL CHECK(mode IN ('embedded','external')),
 revision TEXT,
 file_name TEXT,
 property_set_count INTEGER,
 object_count INTEGER,
 CHECK((revision IS NULL) = (file_name IS NULL))
);
INSERT INTO model_properties(model_id,mode) SELECT id,'embedded' FROM models;


CREATE FUNCTION reject_plan_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Acquisition plans are immutable'; END; $$;
CREATE TRIGGER immutable_plans BEFORE UPDATE ON acquisition_plans FOR EACH ROW EXECUTE FUNCTION reject_plan_update();
CREATE TRIGGER immutable_plan_items BEFORE UPDATE ON acquisition_plan_items FOR EACH ROW EXECUTE FUNCTION reject_plan_update();
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- UTF-8 conversion is fixed here, so a property key is independent of the session.
-- Keeping large external IDs out of B-tree entries preserves the API's ID limits.
CREATE FUNCTION property_key(value TEXT) RETURNS BYTEA LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE
 AS $$ SELECT sha256(convert_to(value, 'UTF8')) $$;
CREATE TABLE property_generations(
 model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 revision TEXT NOT NULL, complete BOOLEAN NOT NULL DEFAULT false,
 source_hash TEXT, property_set_count BIGINT NOT NULL DEFAULT 0,
 object_count BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(model_id,revision)
);
CREATE TABLE property_sets(
 model_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL,
 id_key BYTEA GENERATED ALWAYS AS (property_key(id)) STORED,
 name TEXT NOT NULL, json TEXT NOT NULL, bytes INTEGER NOT NULL,
 PRIMARY KEY(model_id,revision,id_key),
 FOREIGN KEY(model_id,revision) REFERENCES property_generations(model_id,revision) ON DELETE CASCADE
);
CREATE TABLE property_objects(
 model_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL,
 id_key BYTEA GENERATED ALWAYS AS (property_key(id)) STORED,
 PRIMARY KEY(model_id,revision,id_key),
 FOREIGN KEY(model_id,revision) REFERENCES property_generations(model_id,revision) ON DELETE CASCADE
);
CREATE TABLE object_sets(
 model_id TEXT NOT NULL, revision TEXT NOT NULL, object_id TEXT NOT NULL,
 object_key BYTEA GENERATED ALWAYS AS (property_key(object_id)) STORED,
 ordinal INTEGER NOT NULL, set_id TEXT NOT NULL,
 set_key BYTEA GENERATED ALWAYS AS (property_key(set_id)) STORED,
 PRIMARY KEY(model_id,revision,object_key,ordinal),
 FOREIGN KEY(model_id,revision,object_key) REFERENCES property_objects(model_id,revision,id_key) ON DELETE CASCADE,
 FOREIGN KEY(model_id,revision,set_key) REFERENCES property_sets(model_id,revision,id_key) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX property_set_objects ON object_sets(model_id,revision,set_key,object_key);
CREATE TABLE property_values(
 model_id TEXT NOT NULL, revision TEXT NOT NULL, set_id TEXT NOT NULL,
 set_key BYTEA GENERATED ALWAYS AS (property_key(set_id)) STORED,
 name TEXT NOT NULL, value_json TEXT NOT NULL,
 FOREIGN KEY(model_id,revision,set_key) REFERENCES property_sets(model_id,revision,id_key) ON DELETE CASCADE
);
-- Hash long scalar values for candidate lookup, then compare their original JSON.
-- This preserves exact typed equality without exceeding B-tree index entry limits.
CREATE INDEX property_lookup ON property_values(model_id,revision,md5(name),md5(value_json),set_key);
INSERT INTO schema_migrations(version) VALUES(1);
`;
