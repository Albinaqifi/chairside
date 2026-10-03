import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { insertClinic, migratorPool } from './fixtures';

// A withTenant call made inside another one opens a second transaction on a second pooled
// connection. It must never wait forever: nothing may fail silently (docs/intent.md). These
// tests do not prescribe the fix. Refusing the nested call, running it in the outer
// transaction, or failing with a timeout error all pass; only waiting past the deadline fails.
const DEADLINE_MS = 10_000;
type Outcome = 'resolved' | 'rejected' | 'still waiting';

const admin = migratorPool();
let clinicA: string;
let clinicB: string;

beforeAll(async () => {
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** How a promise ends, or 'still waiting' if it has not ended by the deadline. */
async function outcomeBy(promise: Promise<unknown>, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve('still waiting'), ms);
  });
  const settled = promise.then(
    (): Outcome => 'resolved',
    (): Outcome => 'rejected',
  );
  try {
    return await Promise.race([settled, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `nested` inside withTenant(clinicId) and reports how the nested call ended. A nested
 * call still waiting at the deadline makes the outer transaction roll back, which frees what
 * it holds, so the test can end either way. An outer call that fails before its callback runs
 * (for example a connection timeout) failed loudly, so it counts as rejected.
 */
async function nestedOutcome(
  clinicId: string,
  beforeNested: Parameters<typeof withTenant>[1],
  nested: () => Promise<unknown>,
): Promise<{ started: boolean; outcome: Outcome }> {
  let started = false;
  let outcome: Outcome = 'rejected';
  let nestedCall: Promise<unknown> = Promise.resolve();
  await withTenant(clinicId, async (tx) => {
    await beforeNested(tx);
    started = true;
    // Through then(), so a nested call that throws at once counts as rejected.
    const call = Promise.resolve().then(nested);
    nestedCall = call.catch(() => undefined);
    outcome = await outcomeBy(call, DEADLINE_MS);
    if (outcome === 'still waiting') throw new Error('nested call still waiting');
  }).catch(() => undefined);
  await nestedCall;
  return { started, outcome };
}

describe('withTenant inside withTenant', () => {
  it('does not wait forever on a row its own outer transaction has locked', async () => {
    const touch = sql`update clinics set updated_at = updated_at where id = ${clinicA}`;
    const { started, outcome } = await nestedOutcome(
      clinicA,
      (tx) => tx.execute(touch),
      () => withTenant(clinicA, (nested) => nested.execute(touch)),
    );

    expect(started, 'the outer call locked the row and made the nested call').toBe(true);
    expect(outcome).not.toBe('still waiting');
  }, 30_000);

  it('does not wait forever for a connection when outer calls hold them all', async () => {
    // More outer calls than the pool has connections, each making one nested call. The pool
    // size is read from the pool, so a larger pool does not hide the problem.
    const max = (getDb() as unknown as { $client: pg.Pool }).$client.options.max ?? 10;
    const calls = Array.from({ length: max + 2 }, (_, i) => {
      const clinicId = i % 2 === 0 ? clinicA : clinicB;
      return nestedOutcome(
        clinicId,
        (tx) => tx.execute(sql`select pg_sleep(0.3)`),
        () => withTenant(clinicId, (nested) => nested.execute(sql`select 1`)),
      );
    });
    const results = await Promise.all(calls);

    // At least a full pool of outer calls held a connection and made its nested call.
    expect(results.filter((r) => r.started).length).toBeGreaterThanOrEqual(max);
    expect(results.filter((r) => r.outcome === 'still waiting')).toEqual([]);
  }, 60_000);
});
