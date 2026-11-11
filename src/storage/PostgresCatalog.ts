import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from './PostgresDatabase.js';
import { postgresSchema } from './postgresSchema.js';
import { fail } from '../domain/ModelsError.js';

/**
 * Initializes only an empty schema. A schema with unrelated tables is rejected.
 * The migration lock also coordinates two servers starting at the same time.
 */
export async function initializePostgres(db: PostgresDatabase, create: boolean): Promise<string> {
  return db.transaction(async () => {
    await db.lock('schema-migration');
    const schema = db.schema;
    const exists = await db.one('SELECT oid FROM pg_namespace WHERE nspname=$1', [schema]);
    if (!exists) {
      if (!create) fail('LIBRARY_NOT_FOUND', 'PostgreSQL: library schema does not exist');
      await db.query(`CREATE SCHEMA "${schema}"`);
    }
    const tables = await db.all('SELECT tablename FROM pg_tables WHERE schemaname=$1', [schema]);
    if (!tables.length) {
      if (!create) fail('LIBRARY_NOT_FOUND', 'PostgreSQL: library has not been initialized');
      await db.query(postgresSchema);
      await db.query('INSERT INTO library_info VALUES($1,$2)', [
        randomUUID(),
        new Date().toISOString(),
      ]);
    } else if (!tables.some((row) => row.tablename === 'schema_migrations')) {
      fail('INVALID_LIBRARY', 'PostgreSQL: schema contains unrelated tables');
    }
    const versions = await db.all('SELECT version FROM schema_migrations ORDER BY version');
    if (versions.length !== 1 || versions[0].version !== 1)
      fail('UNSUPPORTED_SCHEMA', 'PostgreSQL: unsupported library schema');
    const identity = await db.all('SELECT id FROM library_info');
    if (identity.length !== 1) fail('INVALID_LIBRARY', 'PostgreSQL: invalid library identity');
    return identity[0].id as string;
  });
}
