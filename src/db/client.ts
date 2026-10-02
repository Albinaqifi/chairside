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

// One pool per process, kept on globalThis so hot reloads in development reuse it.
const state = globalThis as typeof globalThis & { chairsideDb?: DbState };

export function getDb(): NodePgDatabase {
  if (!state.chairsideDb) {
    const pool = new pg.Pool({ connectionString: requiredEnv('DATABASE_URL') });
    // An idle connection can fail, for example when the database restarts. Log it instead of
    // letting the error crash the process; the pool replaces the connection.
    pool.on('error', (err) => logger.error({ err }, 'idle database connection failed'));
    state.chairsideDb = { pool, db: drizzle(pool) };
  }
  return state.chairsideDb.db;
}

/** Closes the pool: for tests and graceful shutdown. */
export async function closeDb(): Promise<void> {
  const current = state.chairsideDb;
  state.chairsideDb = undefined;
  await current?.pool.end();
}
