import { AsyncLocalStorage } from 'node:async_hooks';
import { types, Pool, type PoolClient, type QueryResultRow } from 'pg';
import { ModelsError, fail } from '../domain/ModelsError.js';

/**
 * Server-only connection options. Each library owns one PostgreSQL schema.
 */
export interface PostgresOptions {

  /**
   * PostgreSQL URL, supplied by the server and never returned to browser clients.
   */
  connectionString: string;

  /**
   * Library-owned schema; defaults to models. Existing asset roots keep their binding.
   */
  schema?: string;

  /**
   * Maximum connections held by this library instance, from 1 to 20. Defaults to 5.
   */
  maxConnections?: number;
}
interface TransactionContext {
  client: PoolClient;
  active: boolean;
  failed: boolean;
}

/**
 * Owns connections and transaction lifetimes. Repositories use the same client
 * throughout a transaction, including calls made by another repository.
 */
export class PostgresDatabase {
  private readonly pool: Pool;
  private readonly context = new AsyncLocalStorage<TransactionContext>();
  private closed = false;
  readonly schema: string;

  constructor(
    readonly root: string,
    options: PostgresOptions,
  ) {
    this.schema = options.schema ?? 'models';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(this.schema))
      fail('INVALID_LIBRARY', 'PostgreSQL: invalid schema name');
    const max = options.maxConnections ?? 5;
    if (!Number.isInteger(max) || max < 1 || max > 20)
      fail('INVALID_LIBRARY', 'PostgreSQL: pool size must be between 1 and 20');
    this.pool = new Pool({
      connectionString: options.connectionString,
      max,
      types: {
        getTypeParser: (oid, format) =>
          oid === 20
            ? (value: string) => {
                const n = Number(value);
                if (!Number.isSafeInteger(n))
                  fail('DATABASE_ERROR', 'PostgreSQL integer exceeds API range');
                return n;
              }
            : types.getTypeParser(oid, format),
      },
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 60000,
      application_name: 'xeokit-models',
      options: `-c search_path=${this.schema},pg_catalog`,
    });
    // Idle connection failures must not become uncaught EventEmitter errors.
    // The next operation reports a typed database failure to its caller.
    this.pool.on('error', () => {});
  }

  /**
   * Run a parameterized PostgreSQL statement. Credentials never enter errors.
   */
  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    if (this.closed) fail('LIBRARY_CLOSED', 'PostgreSQL: library is closed');
    const context = this.context.getStore();
    if (context && !context.active)
      fail('DATABASE_ERROR', 'PostgreSQL: transaction has already finished');
    try {
      return await (context?.client ?? this.pool).query<T>(text, values);
    } catch (cause) {
      if (context) context.failed = true;
      const code = (cause as { code?: string }).code;
      if (code === 'P0001' && (cause as Error).message === 'Acquisition plans are immutable')
        throw new ModelsError('CONFLICT', 'Acquisition plans are immutable', { cause });
      throw new ModelsError(
        code === '55P03' ? 'LIBRARY_LOCKED' : code === '23505' ? 'CONFLICT' : 'DATABASE_ERROR',
        `PostgreSQL operation failed${code && /^[A-Z0-9]{5}$/.test(code) ? ` (${code})` : ''}`,
        { cause },
      );
    }
  }

  /**
   * Return all rows without exposing the driver's result object.
   */
  async all<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<T[]> {
    return (await this.query<T>(text, values)).rows;
  }

  /**
   * Return one row, or undefined when no record matches.
   */
  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<T | undefined> {
    return (await this.query<T>(text, values)).rows[0];
  }

  /**
   * Commit only when all awaited work succeeds. Nested work shares ownership;
   * swallowing an inner database error never turns a failed transaction into success.
   */
  async transaction<T>(work: () => T | Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      if (!parent.active) fail('DATABASE_ERROR', 'PostgreSQL: expired transaction');
      try {
        return await work();
      } catch (error) {
        parent.failed = true;
        throw error;
      }
    }
    if (this.closed) fail('LIBRARY_CLOSED', 'PostgreSQL: library is closed');
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new ModelsError('DATABASE_ERROR', 'PostgreSQL connection failed', { cause });
    }
    const context: TransactionContext = { client, active: true, failed: false };
    let connectionError: Error | undefined;
    const onError = (error: Error) => {
      connectionError = error;
      context.failed = true;
    };
    // A checked-out client is no longer covered by the pool's idle error listener.
    // Keep this listener until release so socket failure cannot crash the server.
    client.on('error', onError);
    try {
      await client.query('BEGIN');
      return await this.context.run(context, async () => {
        const result = await work();
        if (context.failed) fail('DATABASE_ERROR', 'PostgreSQL: transaction must be rolled back');
        await client.query('COMMIT');
        return result;
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof ModelsError) throw error;
      throw new ModelsError('DATABASE_ERROR', 'PostgreSQL transaction failed', { cause: error });
    } finally {
      context.active = false;
      client.release(connectionError);
      client.off('error', onError);
    }
  }

  /**
   * Serialize a named operation until its transaction ends. Different models
   * can use different names; publication and deletion use the same model name.
   */
  async lock(name: string): Promise<void> {
    if (!this.context.getStore()?.active)
      fail('DATABASE_ERROR', 'PostgreSQL: locks require a transaction');
    await this.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `${this.schema}:${name}`,
    ]);
  }

  /**
   * Release the pool after the owning library has drained accepted operations.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
