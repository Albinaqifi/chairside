import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { logger } from '@/lib/logger';
import { requiredEnv } from './required-env';

/**
 * The app's connection pool. It connects as the app role (DATABASE_URL), which cannot bypass
 * Row-Level Security or change the schema. Application code does not use it directly: it
 * reaches tenant data only through withTenant() in ./tenant.ts.
 */
interface DbState {
  pool: pg.Pool;
  db: NodePgDatabase;
}

/**
 * Longest wait for a connection. When every pooled connection is busy, the call then fails with
 * "timeout exceeded when trying to connect"; when opening a new connection takes too long, with
 * "Connection terminated due to connection timeout". Nothing waits forever.
 */
export const CONNECTION_TIMEOUT_MS = 5_000;

// One pool per process, kept on globalThis so hot reloads in development reuse it.
const state = globalThis as typeof globalThis & { chairsideDb?: DbState };

function dbState(): DbState {
  if (!state.chairsideDb) {
    const pool = new pg.Pool({
      connectionString: requiredEnv('DATABASE_URL'),
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    // An idle connection can fail, for example when the database restarts. Log it instead of
    // letting the error crash the process; the pool replaces the connection.
    pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));
    state.chairsideDb = { pool, db: drizzle(pool) };
  }
  return state.chairsideDb;
}

export function getDb(): NodePgDatabase {
  return dbState().db;
}

/**
 * Takes one connection from the pool, waiting at most CONNECTION_TIMEOUT_MS. Only withTenant uses
 * it: it resets the connection before releasing it.
 */
export function connect(): Promise<pg.PoolClient> {
  return dbState().pool.connect();
}

/** Closes the pool: for tests and graceful shutdown. */
export async function closeDb(): Promise<void> {
  const current = state.chairsideDb;
  state.chairsideDb = undefined;
  await current?.pool.end();
}
