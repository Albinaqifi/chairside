import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { expectPgError, insertClinic, migratorPool, PG } from './fixtures';

// The audit log is append-only for the app: it may insert and read, never update or delete.
const admin = migratorPool();
let clinicId: string;
const auditId = newId();

beforeAll(async () => {
  clinicId = await insertClinic(admin);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

describe('audit log, as the app role', () => {
  it('can insert and read rows in its clinic', async () => {
    const rows = await withTenant(clinicId, async (tx) => {
      await tx.execute(sql`
        insert into audit_log (id, clinic_id, at, actor_type, action, metadata)
        values (${auditId}, ${clinicId}, '2026-03-10T09:00:00Z', 'system', 'test.append',
                '{"field": "status"}')`);
      return (await tx.execute(sql`select id, action from audit_log where id = ${auditId}`)).rows;
    });
    expect(rows).toEqual([{ id: auditId, action: 'test.append' }]);
  });

  it('cannot update rows', async () => {
    await expectPgError(
      withTenant(clinicId, (tx) =>
        tx.execute(sql`update audit_log set action = 'changed' where id = ${auditId}`),
      ),
      PG.insufficientPrivilege,
    );
  });

  it('cannot delete rows', async () => {
    await expectPgError(
      withTenant(clinicId, (tx) => tx.execute(sql`delete from audit_log where id = ${auditId}`)),
      PG.insufficientPrivilege,
    );
  });

  it('cannot truncate the table', async () => {
    await expectPgError(
      withTenant(clinicId, (tx) => tx.execute(sql`truncate audit_log`)),
      PG.insufficientPrivilege,
    );
  });

  it('left the row exactly as it was written', async () => {
    const { rows } = await admin.query('select action from audit_log where id = $1', [auditId]);
    expect(rows).toEqual([{ action: 'test.append' }]);
  });
});
