import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { isUuid } from '@/lib/ids';
import { getDb } from './client';

type Database = ReturnType<typeof getDb>;

/** A database transaction scoped to one clinic. */
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Longest wait for a row or table lock inside a tenant transaction. Then the statement fails with
 * SQLSTATE 55P03 (lock_not_available): nothing waits forever.
 */
export const LOCK_TIMEOUT_MS = 5_000;

/** Seen by everything that runs inside a withTenant call; `open` until its transaction ends. */
const tenantCall = new AsyncLocalStorage<{ open: boolean }>();

/**
 * Runs `fn` in one database transaction scoped to one clinic. Row-Level Security policies read
 * the clinic from the transaction, so `fn` sees and changes only that clinic's rows. This is
 * the only way application code reaches tenant tables.
 *
 * The clinic setting is local to the transaction: it ends with the commit or rollback and never
 * carries over to the next user of the pooled connection. If `fn` throws, everything it did is
 * rolled back.
 *
 * Open it once, at the edge (action wrapper, job handler), and pass `tx` to the module functions
 * that need the database. A call made while another withTenant transaction is still open in the
 * same flow is refused at once: it would need a second connection, and could wait forever for a
 * lock the first transaction holds, or for a connection while the outer calls hold them all.
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
    return await tenantCall.run(call, () =>
      getDb().transaction(async (tx) => {
        await tx.execute(sql`
          select set_config('app.clinic_id', ${clinicId}, true),
                 set_config('lock_timeout', ${`${LOCK_TIMEOUT_MS}ms`}, true)`);
        return fn(tx);
      }),
    );
  } finally {
    call.open = false;
  }
}
