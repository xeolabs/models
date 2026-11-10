
/**
 * Queue records survive restarts. Only one worker may own this library at a time.
 */
export const processingMigration = `
CREATE TABLE processing_settings(id INTEGER PRIMARY KEY CHECK(id=1),settings_json TEXT NOT NULL);
INSERT INTO processing_settings VALUES(1,'{"automaticIFC":false,"paused":false,"memoryLimitMiB":2048,"reserveMemoryMiB":1024,"cpuCores":1,"timeoutMinutes":60}');
CREATE TABLE processing_jobs(
 id TEXT PRIMARY KEY, model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, format TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL,
 phase TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
 heartbeat_at TEXT, memory_bytes INTEGER, cpu_percent REAL,
 owner_json TEXT, error_code TEXT, error_message TEXT
);
CREATE UNIQUE INDEX processing_active ON processing_jobs(model_id,kind,format)
 WHERE status IN ('queued','running','cancelling');
CREATE INDEX processing_status ON processing_jobs(status,source,created_at,id);
PRAGMA user_version=2;
`;
