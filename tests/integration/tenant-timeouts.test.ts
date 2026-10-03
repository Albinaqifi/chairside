import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, CONNECTION_TIMEOUT_MS, getDb } from '@/db/client';
import { LOCK_TIMEOUT_MS, withTenant } from '@/db/tenant';
import { expectPgError, insertClinic, migratorPool, PG } from './fixtures';

// Nothing may wait forever (docs/intent.md: nothing fails silently). A tenant transaction that
// waits too long for a lock, and a call that waits too long for a pooled connection, fail with
// an error. The calls here are independent, not nested: nesting is refused (tenant-isolation).
const MARGIN_MS = 3_000;

const admin = migratorPool();
let clinicId: string;

beforeAll(async () => {
  clinicId = await insertClinic(admin);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** A promise and the function that resolves it. */
function signal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('waits inside withTenant end with an error', () => {
  it('a statement waiting for a lock fails after the lock timeout', async () => {
    const locked = signal();
    const finish = signal();
    const holder = withTenant(clinicId, async (tx) => {
      await tx.execute(sql`select id from clinics where id = ${clinicId} for update`);
      locked.resolve();
      await finish.promise;
    });
    await locked.promise;

    const started = performance.now();
    await expectPgError(
      withTenant(clinicId, (tx) =>
        tx.execute(sql`update clinics set updated_at = updated_at where id = ${clinicId}`),
      ),
      PG.lockNotAvailable,
    );
    const waited = performance.now() - started;
    finish.resolve();
    await holder;

    expect(waited).toBeGreaterThanOrEqual(LOCK_TIMEOUT_MS - 100);
    expect(waited).toBeLessThan(LOCK_TIMEOUT_MS + MARGIN_MS);
  }, 20_000);

  it('a call waiting for a pooled connection fails after the connection timeout', async () => {
    // Every connection of the pool is held by an open transaction; the pool size is read from it.
    const max = (getDb() as unknown as { $client: pg.Pool }).$client.options.max ?? 10;
    const allHeld = signal();
    const finish = signal();
    let held = 0;
    const holders = Array.from({ length: max }, () =>
      withTenant(clinicId, async () => {
        held += 1;
        if (held === max) allHeld.resolve();
        await finish.promise;
      }),
    );
    await allHeld.promise;

    let ran = false;
    const started = performance.now();
    await expect(
      withTenant(clinicId, async () => {
        ran = true;
      }),
    ).rejects.toThrow('timeout exceeded when trying to connect');
    const waited = performance.now() - started;
    finish.resolve();
    await Promise.all(holders);

    expect(ran).toBe(false);
    expect(waited).toBeGreaterThanOrEqual(CONNECTION_TIMEOUT_MS - 100);
    expect(waited).toBeLessThan(CONNECTION_TIMEOUT_MS + MARGIN_MS);
  }, 20_000);
});
