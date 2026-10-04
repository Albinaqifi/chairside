import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { isUuid } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { withoutQueryValues } from '@/lib/query-errors';
import { connect } from './client';

/** A database transaction scoped to one clinic. */
export type TenantTransaction = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/**
 * Longest wait for a row or table lock inside a tenant transaction. Then the statement fails with
 * SQLSTATE 55P03 (lock_not_available): nothing waits forever.
 */
export const LOCK_TIMEOUT_MS = 5_000;

/** Seen by everything that runs inside a withTenant call; `open` until the call is done. */
const tenantCall = new AsyncLocalStorage<{ open: boolean }>();

/**
 * Runs `fn` in one database transaction scoped to one clinic. Row-Level Security policies read
 * the clinic from the transaction, so `fn` sees and changes only that clinic's rows. This is
 * the only way application code reaches tenant tables.
 *
 * The clinic setting is local to the transaction. If `fn` throws, everything it did is rolled
 * back. After the commit or rollback the connection is reset (DISCARD ALL) before it goes back to
 * the pool, so nothing the transaction left on it, such as a held cursor, a session-level setting
 * or an advisory lock, reaches the next user of that connection. A connection that cannot be
 * reset is closed instead.
 *
 * Open it once, at the edge (action wrapper, job handler), and pass `tx` to the module functions
 * that need the database. A call made while another withTenant call is still running in the same
 * flow is refused at once: it would need a second connection, and could wait forever for a lock
 * the first transaction holds, or for a connection while the outer calls hold them all.
 *
 * No error leaves with the values a failed query was sent, whether it came from `fn`, the commit
 * or the rollback, and also when it sits in the `cause` of another error (D-070): it is replaced
 * by the copy withoutQueryValues() makes, which keeps the PostgreSQL code and constraint name.
 * Next.js prints an error that escapes a page, outside our logger.
 */
export async function withTenant<T>(
  clinicId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(clinicId)) throw new TypeError('withTenant: clinicId must be a UUID');
  if (tenantCall.getStore()?.open) {
    throw new Error(
      'withTenant: called inside another withTenant. Pass its tx to the function you call ' +
        'instead of opening a second transaction (CLAUDE.md, code conventions).',
    );
  }
  const call = { open: true };
  try {
    return await tenantCall.run(call, () => inTenantTransaction(clinicId, fn));
  } catch (error) {
    throw withoutQueryValues(error);
  } finally {
    call.open = false;
  }
}

async function inTenantTransaction<T>(
  clinicId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const client = await connect();
  client.on('error', onConnectionError);
  try {
    return await drizzle(client).transaction(async (tx) => {
      await tx.execute(sql`
        select set_config('app.clinic_id', ${clinicId}, true),
               set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}, true)`);
      return fn(tx);
    });
  } finally {
    await resetAndRelease(client);
  }
}

/**
 * Gives the connection back to the pool with nothing left on it from the transaction. DISCARD ALL
 * closes cursors and ends session-level settings, advisory locks, prepared statements and
 * listeners. A connection that cannot be reset is closed instead, because what is left on it is
 * unknown. The transaction's own outcome stands either way: a failed reset is logged, not thrown.
 */
async function resetAndRelease(client: pg.PoolClient): Promise<void> {
  let resetError: unknown;
  try {
    await client.query('DISCARD ALL');
  } catch (err) {
    resetError = err;
  }
  client.removeListener('error', onConnectionError);
  if (resetError === undefined) {
    client.release();
    return;
  }
  client.release(true); // true: the pool closes the connection instead of keeping it
  logger.error({ err: resetError }, 'withTenant: database connection reset failed; it was closed');
}

/**
 * A connection can fail while withTenant holds it, for example when its server process ends. pg
 * then emits 'error' on it, which would end the Node process if nothing listened. The statements
 * on that connection fail as well, and so does its reset, so the connection is closed.
 */
function onConnectionError(err: Error): void {
  logger.error({ err }, 'withTenant: database connection failed while in use');
}
