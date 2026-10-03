import { EventEmitter } from 'node:events';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { expectPgError, insertClinic, migratorPool, PG } from './fixtures';

// Added by the tester (round 2). withTenant refuses a call made while another one is open in the
// same flow (D-060); it tracks that with AsyncLocalStorage. These tests schedule the nested call
// in the other ways Node offers, check that calls running side by side are not refused, and check
// that a lock or connection timeout leaves the pooled connections clean and the pool usable.
const NESTED = 'called inside another withTenant';
const TIMED_OUT = 'timeout exceeded when trying to connect';

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

function appPool(): pg.Pool {
  return (getDb() as unknown as { $client: pg.Pool }).$client;
}

async function visibleClinics(tx: TenantTransaction): Promise<unknown[]> {
  const { rows } = await tx.execute(sql`select id from clinics`);
  return rows.map((row) => row.id);
}

/** A promise and the function that resolves it. */
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** The message a promise rejects with, or 'resolved'. Handles the rejection at once. */
function settle(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'resolved',
    (e: unknown) => (e as Error).message,
  );
}

/** Takes every connection the pool holds at the same time, runs one query on each. */
async function onEveryConnection(query: string): Promise<Record<string, unknown>[]> {
  const pool = appPool();
  const clients = await Promise.all(Array.from({ length: pool.totalCount }, () => pool.connect()));
  try {
    return await Promise.all(clients.map(async (client) => (await client.query(query)).rows[0]));
  } finally {
    for (const client of clients) client.release();
  }
}

describe('the nested-call refusal', () => {
  it('refuses calls scheduled from inside by timers, microtasks, emitters and thenables', async () => {
    let nestedRan = 0;
    const nested = () =>
      withTenant(clinicB, async () => {
        nestedRan += 1;
      });
    const emitter = new EventEmitter();
    const fromEmitter: Promise<string>[] = [];
    // The listener is added outside withTenant; it runs inside, when the event is emitted there.
    emitter.on('booked', () => fromEmitter.push(settle(nested())));

    const outcomes = await withTenant(clinicA, async () => {
      const scheduled = [
        new Promise<string>((done) => setTimeout(() => done(settle(nested())), 0)),
        new Promise<string>((done) => setImmediate(() => done(settle(nested())))),
        new Promise<string>((done) => process.nextTick(() => done(settle(nested())))),
        new Promise<string>((done) => queueMicrotask(() => done(settle(nested())))),
        settle(Promise.resolve({ then: (done: (value: unknown) => void) => done(nested()) })),
      ];
      emitter.emit('booked');
      return Promise.all([...scheduled, ...fromEmitter]);
    });

    expect(outcomes).toHaveLength(6);
    for (const outcome of outcomes) expect(outcome).toContain(NESTED);
    expect(nestedRan).toBe(0);
  });

  it('does not refuse calls that run side by side, and each sees its own clinic', async () => {
    const max = appPool().options.max ?? 10;
    const clinics = Array.from({ length: max }, (_, i) => (i % 2 ? clinicA : clinicB));
    const seen = await Promise.all(
      clinics.map((clinic) =>
        withTenant(clinic, async (tx) => {
          const rows = await visibleClinics(tx);
          await new Promise((resolve) => setTimeout(resolve, 20)); // all open at the same time
          return rows;
        }),
      ),
    );
    expect(seen).toEqual(clinics.map((clinic) => [clinic]));
  });
});

describe('after a timeout', () => {
  it('a lock timeout leaves no clinic and no lock limit on the connections', async () => {
    const locked = signal();
    const finish = signal();
    const holder = withTenant(clinicA, async (tx) => {
      await tx.execute(sql`select id from clinics where id = ${clinicA} for update`);
      locked.resolve();
      await finish.promise;
    });
    await locked.promise;
    await expectPgError(
      withTenant(clinicA, (tx) =>
        tx.execute(sql`update clinics set updated_at = updated_at where id = ${clinicA}`),
      ),
      PG.lockNotAvailable,
    );
    finish.resolve();
    await holder;

    // Outside any transaction: the clinic and the limit were both local to their transactions.
    const states = await onEveryConnection(`
      select coalesce(current_setting('app.clinic_id', true), '') as clinic,
             current_setting('lock_timeout') as lock_timeout`);
    expect(states.length).toBeGreaterThanOrEqual(2);
    for (const state of states) expect(state).toEqual({ clinic: '', lock_timeout: '0' });
    expect(await withTenant(clinicB, visibleClinics)).toEqual([clinicB]);
  }, 20_000);

  it('calls that time out waiting for a connection leave the pool usable', async () => {
    const pool = appPool();
    const max = pool.options.max ?? 10;
    const allHeld = signal();
    const finish = signal();
    let held = 0;
    const holders = Array.from({ length: max }, () =>
      withTenant(clinicA, async () => {
        held += 1;
        if (held === max) allHeld.resolve();
        await finish.promise;
      }),
    );
    await allHeld.promise;

    const outcomes = await Promise.all([
      settle(withTenant(clinicB, visibleClinics)),
      settle(withTenant(clinicB, visibleClinics)),
    ]);
    expect(outcomes).toEqual([TIMED_OUT, TIMED_OUT]);
    expect(pool.waitingCount).toBe(0);
    finish.resolve();
    await Promise.all(holders);

    const again = await Promise.all(
      Array.from({ length: max }, () => withTenant(clinicB, visibleClinics)),
    );
    expect(again).toEqual(Array.from({ length: max }, () => [clinicB]));
    expect(pool.totalCount).toBeLessThanOrEqual(max);
  }, 20_000);
});
