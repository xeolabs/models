import fs from 'node:fs';
import path from 'node:path';
import { noLinks } from './paths.js';
import { fail } from '../domain/ModelsError.js';
import { PostgresDatabase, type PostgresOptions } from './PostgresDatabase.js';
import { initializePostgres } from './PostgresCatalog.js';

/**
 * The library owns one PostgreSQL catalog and one local asset directory.
 * SQLite sources are opened only by the explicit migration command.
 */
export class Database extends PostgresDatabase {
  constructor(root: string, options?: PostgresOptions) {
    noLinks(root);
    const bindingPath = path.join(root, 'postgres.json');
    noLinks(bindingPath);
    const binding = fs.existsSync(bindingPath)
      ? JSON.parse(fs.readFileSync(bindingPath, 'utf8'))
      : undefined;
    const connectionString = options?.connectionString ?? process.env.MODELS_DATABASE_URL;
    if (!connectionString) fail('INVALID_LIBRARY', 'Open library: configure MODELS_DATABASE_URL');
    super(root, { ...options, connectionString, schema: options?.schema ?? binding?.schema });
  }

  /**
   * Verify identity before accepting requests. The binding contains no password.
   */
  static async open(root: string, create = false, options?: PostgresOptions): Promise<Database> {
    noLinks(root);
    const bindingPath = path.join(root, 'postgres.json');
    noLinks(bindingPath);
    if (!fs.existsSync(bindingPath) && fs.existsSync(path.join(root, 'models.db')))
      fail('INVALID_LIBRARY', 'Open library: migrate this SQLite library before using PostgreSQL');
    if (!fs.existsSync(root)) {
      if (!create) fail('LIBRARY_NOT_FOUND', 'Open library: asset directory is missing');
      fs.mkdirSync(root, { recursive: true });
    }
    const db = new Database(root, options);
    try {
      if (
        !fs.existsSync(bindingPath) &&
        (await db.one('SELECT to_regclass($1) present', [db.schema + '.library_info']))?.present
      )
        fail(
          'LIBRARY_ALREADY_EXISTS',
          'Open library: this database is already initialized; restore its matching asset binding',
        );
      const id = await initializePostgres(db, create);
      if (fs.existsSync(bindingPath)) {
        const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
        if (binding.libraryId !== id || binding.schema !== db.schema)
          fail('INVALID_LIBRARY', 'Open library: database does not belong to this asset directory');
      } else
        fs.writeFileSync(
          bindingPath,
          JSON.stringify({ libraryId: id, schema: db.schema }, null, 2) + '\n',
          { flag: 'wx', mode: 0o600 },
        );
      return db;
    } catch (error) {
      await db.close();
      throw error;
    }
  }
}
