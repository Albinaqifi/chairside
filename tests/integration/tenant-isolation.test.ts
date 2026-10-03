import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { withTenant, type TenantTransaction } from '@/db/tenant';
import { newId } from '@/lib/ids';
import {
  appPool,
  expectPgError,
  insertAuditEntry,
  insertClinic,
  migratorPool,
  PG,
} from './fixtures';

const admin = migratorPool();
const appWithoutTenant = appPool();
let clinicA: string;
let clinicB: string;

beforeAll(async () => {
  clinicA = await insertClinic(admin);
  clinicB = await insertClinic(admin);
  await insertAuditEntry(admin, clinicA);
  await insertAuditEntry(admin, clinicB);
});

afterAll(async () => {
  await closeDb();
  await appWithoutTenant.end();
  await admin.end();
});

async function visibleClinics(tx: TenantTransaction): Promise<unknown[]> {
  const { rows } = await tx.execute(sql`select id from clinics`);
  return rows.map((row) => row.id);
}

function insertAuditRow(tx: TenantTransaction, clinicId: string, id = newId()) {
  return tx.execute(sql`
    insert into audit_log (id, clinic_id, at, actor_type, action)
    values (${id}, ${clinicId}, '2026-03-10T09:00:00Z', 'system', 'test.isolation')`);
}

describe('inside clinic A (withTenant)', () => {
  it('sees only clinic A', async () => {
    await withTenant(clinicA, async (tx) => {
      expect(await visibleClinics(tx)).toEqual([clinicA]);
      const audit = await tx.execute(sql`select distinct clinic_id from audit_log`);
      expect(audit.rows).toEqual([{ clinic_id: clinicA }]);
    });
  });

  it('cannot read clinic B, even by its id', async () => {
    await withTenant(clinicA, async (tx) => {
      expect((await tx.execute(sql`select id from clinics where id = ${clinicB}`)).rows).toEqual(
        [],
      );
      const audit = await tx.execute(sql`select id from audit_log where clinic_id = ${clinicB}`);
      expect(audit.rows).toEqual([]);
    });
  });

  it('cannot change clinic B', async () => {
    const result = await withTenant(clinicA, (tx) =>
      tx.execute(sql`update clinics set name = 'Changed' where id = ${clinicB}`),
    );
    expect(result.rowCount).toBe(0);
    const { rows } = await admin.query('select name from clinics where id = $1', [clinicB]);
    expect(rows[0].name).not.toBe('Changed');
  });

  it('cannot write rows for clinic B', async () => {
    await expectPgError(
      withTenant(clinicA, (tx) => insertAuditRow(tx, clinicB)),
      PG.insufficientPrivilege,
    );
  });

  it('cannot move its own row to another clinic', async () => {
    await expectPgError(
      withTenant(clinicA, (tx) =>
        tx.execute(sql`update clinics set id = ${newId()} where id = ${clinicA}`),
      ),
      PG.insufficientPrivilege,
    );
  });
});

describe('without a clinic set', () => {
  it('the app role sees no rows at all', async () => {
    expect((await appWithoutTenant.query('select id from clinics')).rows).toEqual([]);
    expect((await appWithoutTenant.query('select id from audit_log')).rows).toEqual([]);
  });

  it('the app role cannot write rows', async () => {
    await expectPgError(
      appWithoutTenant.query(
        `insert into audit_log (id, clinic_id, at, actor_type, action)
         values ($1, $2, '2026-03-10T09:00:00Z', 'system', 'test.no-tenant')`,
        [newId(), clinicA],
      ),
      PG.insufficientPrivilege,
    );
  });

  it('a connection sees nothing once the transaction that set a clinic has ended', async () => {
    const client = await appWithoutTenant.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.clinic_id', $1, true)`, [clinicA]);
      expect((await client.query('select id from clinics')).rows).toEqual([{ id: clinicA }]);
      await client.query('commit');

      // The setting now reads as '' on this connection, not NULL: still no rows, no error.
      expect((await client.query('select id from clinics')).rows).toEqual([]);
    } finally {
      client.release();
    }
  });
});

describe('withTenant', () => {
  it('keeps concurrent transactions for different clinics apart', async () => {
    const slowly = (clinicId: string) =>
      withTenant(clinicId, async (tx) => {
        await tx.execute(sql`select pg_sleep(0.2)`);
        return visibleClinics(tx);
      });
    expect(await Promise.all([slowly(clinicA), slowly(clinicB)])).toEqual([[clinicA], [clinicB]]);
  });

  it('leaves no clinic behind on the pooled connections', async () => {
    for (let i = 0; i < 20; i++) {
      const clinic = i % 2 === 0 ? clinicA : clinicB;
      expect(await withTenant(clinic, visibleClinics)).toEqual([clinic]);
    }
    const { rows } = await getDb().execute(sql`select current_clinic_id() as clinic_id`);
    expect(rows).toEqual([{ clinic_id: null }]);
  });

  it('rolls back everything when fn throws', async () => {
    const auditId = newId();
    await expect(
      withTenant(clinicA, async (tx) => {
        await insertAuditRow(tx, clinicA, auditId);
        throw new Error('fail after writing');
      }),
    ).rejects.toThrow('fail after writing');
    const { rows } = await admin.query('select id from audit_log where id = $1', [auditId]);
    expect(rows).toEqual([]);
  });

  it('rejects a clinic id that is not a UUID before touching the database', async () => {
    let called = false;
    await expect(
      withTenant("x' or '1'='1", async () => {
        called = true;
      }),
    ).rejects.toThrow(TypeError);
    expect(called).toBe(false);
  });

  it('refuses a withTenant call inside another at once, and the outer one carries on', async () => {
    const auditId = newId();
    let nestedRan = false;
    const refusal = await withTenant(clinicA, async (tx) => {
      const error = await withTenant(clinicA, async () => {
        nestedRan = true;
      }).then(
        () => undefined,
        (e: unknown) => e,
      );
      await insertAuditRow(tx, clinicA, auditId);
      return error;
    });

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain('called inside another withTenant');
    expect(nestedRan).toBe(false);
    const { rows } = await admin.query('select id from audit_log where id = $1', [auditId]);
    expect(rows).toEqual([{ id: auditId }]);
  });

  it('refuses it for another clinic too, and from work started without await', async () => {
    const outcomes = await withTenant(clinicA, async () => {
      const calls = [
        withTenant(clinicB, visibleClinics),
        Promise.resolve().then(() => withTenant(clinicA, visibleClinics)),
      ];
      return (await Promise.allSettled(calls)).map((result) => result.status);
    });
    expect(outcomes).toEqual(['rejected', 'rejected']);
  });

  it('allows a call from work the first one started, once its transaction has ended', async () => {
    let release!: () => void;
    const firstEnded = new Promise<void>((resolve) => {
      release = resolve;
    });
    let later!: Promise<unknown[]>;
    await withTenant(clinicA, async () => {
      later = firstEnded.then(() => withTenant(clinicB, visibleClinics));
    });
    release();
    expect(await later).toEqual([clinicB]);
  });
});
