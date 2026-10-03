import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { expectPgError, insertAuditEntry, insertClinic, migratorPool, PG } from './fixtures';

// After every withTenant transaction, committed or rolled back, the connection is reset with
// DISCARD ALL before it goes back to the pool (D-061). Nothing one clinic's transaction left on
// the connection reaches the next transaction on it: not a cursor held open past the commit, not
// a session-level setting (E00-T01 testing, findings 7 and 15). A connection that cannot be reset
// is closed, never pooled again.
const LOCK_KEY = 7_301_015; // an advisory lock key no other test uses

const admin = migratorPool();
let clinicA: string;
let clinicB: string;

beforeAll(async () => {
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
  await insertAuditEntry(admin, clinicA);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

function appPool(): pg.Pool {
  return (getDb() as unknown as { $client: pg.Pool }).$client;
}

/** The id of the PostgreSQL server process behind the connection: the same id, the same connection. */
async function backendPid(tx: TenantTransaction): Promise<number> {
  const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`);
  return Number(rows[0]?.pid);
}

/** The client the pool closes next, or 'not closed' if it closes none within a second. */
function nextClosedConnection(pool: pg.Pool): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('not closed'), 1_000);
    pool.once('remove', (client) => {
      clearTimeout(timer);
      resolve(client);
    });
  });
}

describe('the connection reset after every withTenant transaction', () => {
  it('closes a cursor one clinic held open, before the next transaction on that connection', async () => {
    const pidA = await withTenant(clinicA, async (tx) => {
      // WITH HOLD: the cursor is filled at the commit and, without the reset, stays on the connection.
      await tx.execute(
        sql`declare held_rows cursor with hold for select id, clinic_id from audit_log`,
      );
      return backendPid(tx);
    });

    let pidB: number | undefined;
    await expectPgError(
      withTenant(clinicB, async (tx) => {
        pidB = await backendPid(tx);
        return tx.execute(sql`fetch all from held_rows`);
      }),
      PG.invalidCursorName,
    );
    expect(pidB, 'the next transaction ran on the same pooled connection').toBe(pidA);
  });

  it('clears a session-level SET app.clinic_id before the next transaction on that connection', async () => {
    const pidA = await withTenant(clinicA, async (tx) => {
      // SET without LOCAL: without the reset it outlives the commit (finding 7).
      await tx.execute(sql.raw(`set app.clinic_id = '${clinicB}'`));
      return backendPid(tx);
    });

    // The next transaction on that connection, as the app role but outside withTenant.
    const client = await appPool().connect();
    let state: Record<string, unknown> | undefined;
    try {
      await client.query('begin');
      ({
        rows: [state],
      } = await client.query(`
        select pg_backend_pid() as pid, current_clinic_id() as clinic_id,
               (select count(*)::int from clinics) as visible_clinics`));
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(state?.pid, 'the next transaction ran on the same pooled connection').toBe(pidA);
    expect(state).toMatchObject({ clinic_id: null, visible_clinics: 0 });
  });

  it('resets the connection after a rollback too: a session-level advisory lock is released', async () => {
    let pidA: number | undefined;
    await expect(
      withTenant(clinicA, async (tx) => {
        pidA = await backendPid(tx);
        // A session-level advisory lock survives the rollback of the transaction that took it.
        await tx.execute(sql`select pg_advisory_lock(${LOCK_KEY})`);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');

    // Another session can take the lock, so it was released...
    const { rows } = await admin.query('select pg_try_advisory_xact_lock($1) as taken', [LOCK_KEY]);
    expect(rows).toEqual([{ taken: true }]);
    // ...by the reset, not by closing the connection: the pool kept it.
    expect(await withTenant(clinicB, backendPid)).toBe(pidA);
  });
});

describe('a connection that cannot be reset', () => {
  it('keeps a committed result, and is closed instead of returned to the pool', async () => {
    // The reset is made to fail on a connection that is otherwise fine. Released normally, the
    // pool would keep such a connection.
    const pool = appPool();
    const takeConnection = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;
    let failing: pg.PoolClient | undefined;
    vi.spyOn(pool, 'connect').mockImplementationOnce((async () => {
      const client = await takeConnection();
      const query = client.query.bind(client) as (...args: unknown[]) => unknown;
      vi.spyOn(client, 'query').mockImplementation(((...args: unknown[]) =>
        typeof args[0] === 'string' && /^\s*discard\s+all\s*$/i.test(args[0])
          ? Promise.reject(new Error('reset refused by the test'))
          : query(...args)) as never);
      failing = client;
      return client;
    }) as never);
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    const auditId = newId();
    const closed = nextClosedConnection(pool);
    const result = await withTenant(clinicA, async (tx) => {
      await tx.execute(sql`
        insert into audit_log (id, clinic_id, at, actor_type, action)
        values (${auditId}, ${clinicA}, '2026-03-10T09:00:00Z', 'system', 'test.reset')`);
      return 'committed';
    });

    expect(result).toBe('committed');
    expect((await admin.query('select id from audit_log where id = $1', [auditId])).rows).toEqual([
      { id: auditId },
    ]);
    expect(await closed, 'the pool closed the connection whose reset failed').toBe(failing);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('reset failed'),
    );
  });

  it('is closed when its server process ends during the transaction, without ending this process', async () => {
    // pg emits 'error' on a connection that dies. With nobody listening, that would end the Node
    // process (and this test run) instead of failing the call.
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    let pidA: number | undefined;
    const closed = nextClosedConnection(appPool());
    await expect(
      withTenant(clinicA, async (tx) => {
        pidA = await backendPid(tx);
        await tx.execute(sql`select pg_terminate_backend(pg_backend_pid())`);
      }),
    ).rejects.toThrow();

    expect(await closed, 'the pool closed the dead connection').not.toBe('not closed');
    expect(logged).toHaveBeenCalled();
    // The next call gets a new connection and works.
    expect(await withTenant(clinicB, backendPid)).not.toBe(pidA);
  });
});
