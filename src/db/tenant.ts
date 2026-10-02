import { sql } from 'drizzle-orm';
import { isUuid } from '@/lib/ids';
import { getDb } from './client';

type Database = ReturnType<typeof getDb>;

/** A database transaction scoped to one clinic. */
export type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Runs `fn` in one database transaction scoped to one clinic. Row-Level Security policies read
 * the clinic from the transaction, so `fn` sees and changes only that clinic's rows. This is
 * the only way application code reaches tenant tables.
 *
 * The clinic setting is local to the transaction: it ends with the commit or rollback and never
 * carries over to the next user of the pooled connection. If `fn` throws, everything it did is
 * rolled back.
 */
export async function withTenant<T>(
  clinicId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(clinicId)) throw new TypeError('withTenant: clinicId must be a UUID');
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.clinic_id', ${clinicId}, true)`);
    return fn(tx);
  });
}
