
/**
 * The catalog owns each model's property mode and published database generation.
 * Large property values live in a separate database, outside the conversion cache.
 */
export const propertiesMigration = `
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
PRAGMA user_version=3;
`;
