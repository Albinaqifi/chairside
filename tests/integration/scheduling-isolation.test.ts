import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { appPool, expectPgError, insertClinic, migratorPool, PG } from './fixtures';
import {
  DELETABLE_TABLES,
  insertClinicRefs,
  insertRow,
  insertSql,
  insertUser,
  SCHEDULING_TABLES,
  validRow,
  type ClinicRefs,
  type SchedulingTable,
} from './scheduling-fixtures';

// E01-T01a, acceptance 1: inside clinic A, none of the seven new tables shows, changes or takes a
// row of clinic B, and without a clinic the app role sees and writes nothing. The meta-test
// (tenant-tables.test.ts) finds each table's clinic_id, Row-Level Security and policy by itself;
// these cases check what the policies and grants do for the app role, the way the app reaches the
// tables (withTenant). Every value is synthetic.

const admin = migratorPool();
const appWithoutTenant = appPool();
let a: ClinicRefs;
let b: ClinicRefs;
/** The id of one row of each table in each clinic. */
const rowIn = {} as Record<SchedulingTable, { a: string; b: string }>;

beforeAll(async () => {
  const userId = await insertUser(admin);
  a = await insertClinicRefs(admin, await insertClinic(admin), userId);
  b = await insertClinicRefs(admin, await insertClinic(admin), userId);
  for (const table of SCHEDULING_TABLES) {
    const rowA = validRow(table, a);
    const rowB = validRow(table, b);
    await insertRow(admin, table, rowA);
    await insertRow(admin, table, rowB);
    rowIn[table] = { a: rowA.id as string, b: rowB.id as string };
  }
});

afterAll(async () => {
  await closeDb();
  await appWithoutTenant.end();
  await admin.end();
});

const named = (table: SchedulingTable) => sql.identifier(table);

/** The row as the migrator sees it (its clinic and last change), or undefined when it is gone. */
async function stored(table: SchedulingTable, id: string) {
  const { rows } = await admin.query<{ clinic_id: string; updated_at: Date }>(
    `select clinic_id, updated_at from ${table} where id = $1`,
    [id],
  );
  return rows[0];
}

describe.each(SCHEDULING_TABLES)('%s inside clinic A (withTenant)', (table) => {
  it("shows clinic A's rows, and not clinic B's, even by its id", async () => {
    await withTenant(a.clinicId, async (tx) => {
      const clinics = await tx.execute(sql`select distinct clinic_id from ${named(table)}`);
      expect(clinics.rows).toEqual([{ clinic_id: a.clinicId }]);
      const own = await tx.execute(
        sql`select id from ${named(table)} where id = ${rowIn[table].a}`,
      );
      expect(own.rows).toEqual([{ id: rowIn[table].a }]);
      const other = await tx.execute(
        sql`select id from ${named(table)} where id = ${rowIn[table].b}`,
      );
      expect(other.rows).toEqual([]);
    });
  });

  it("cannot change clinic B's row, or take it into clinic A", async () => {
    const before = await stored(table, rowIn[table].b);
    const counts = await withTenant(a.clinicId, async (tx) => {
      const changed = await tx.execute(
        sql`update ${named(table)} set updated_at = now() where id = ${rowIn[table].b}`,
      );
      const taken = await tx.execute(
        sql`update ${named(table)} set clinic_id = ${a.clinicId} where id = ${rowIn[table].b}`,
      );
      return [changed.rowCount, taken.rowCount];
    });
    expect(counts).toEqual([0, 0]);
    expect(await stored(table, rowIn[table].b)).toEqual(before);
  });

  it('cannot add a row for clinic B', async () => {
    await expectPgError(
      withTenant(a.clinicId, (tx) => tx.execute(insertSql(table, validRow(table, b, 1)))),
      PG.insufficientPrivilege,
    );
  });

  it('cannot move its own row to clinic B', async () => {
    await expectPgError(
      withTenant(a.clinicId, (tx) =>
        tx.execute(
          sql`update ${named(table)} set clinic_id = ${b.clinicId} where id = ${rowIn[table].a}`,
        ),
      ),
      PG.insufficientPrivilege,
    );
    expect((await stored(table, rowIn[table].a))?.clinic_id).toBe(a.clinicId);
  });

  it('adds a row of its own clinic, and changes it', async () => {
    const row = validRow(table, a, 2);
    const changed = await withTenant(a.clinicId, async (tx) => {
      await tx.execute(insertSql(table, row));
      return (
        await tx.execute(sql`update ${named(table)} set updated_at = now() where id = ${row.id}`)
      ).rowCount;
    });
    expect(changed).toBe(1);
    expect((await stored(table, row.id as string))?.clinic_id).toBe(a.clinicId);
  });
});

describe.each(DELETABLE_TABLES)('%s: a row the app role may delete', (table) => {
  it("deletes a row of its own clinic, never clinic B's", async () => {
    const own = validRow(table, a, 3);
    await insertRow(admin, table, own);
    const counts = await withTenant(a.clinicId, async (tx) => {
      const other = await tx.execute(sql`delete from ${named(table)} where id = ${rowIn[table].b}`);
      const mine = await tx.execute(sql`delete from ${named(table)} where id = ${own.id}`);
      return [other.rowCount, mine.rowCount];
    });
    expect(counts).toEqual([0, 1]);
    expect(await stored(table, rowIn[table].b)).toBeDefined();
    expect(await stored(table, own.id as string)).toBeUndefined();
  });
});

const NEVER_DELETED = SCHEDULING_TABLES.filter((table) => !DELETABLE_TABLES.includes(table));

describe.each(NEVER_DELETED)('%s: archived or made inactive, never deleted', (table) => {
  it('the app role may not delete a row, even of its own clinic', async () => {
    await expectPgError(
      withTenant(a.clinicId, (tx) =>
        tx.execute(sql`delete from ${named(table)} where id = ${rowIn[table].a}`),
      ),
      PG.insufficientPrivilege,
    );
    expect(await stored(table, rowIn[table].a)).toBeDefined();
  });
});

describe('the grants', () => {
  it('give the app role select, insert and update, and delete only on breaks, hours and closed days', async () => {
    const { rows } = await admin.query<{ table_name: string; privileges: string[] }>(
      `select t.name as table_name,
              array_agg(p.privilege order by p.privilege)
                filter (where has_table_privilege('chairside_app', 'public.' || t.name, p.privilege))
                as privileges
         from unnest($1::text[]) as t(name)
         cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
                                 'REFERENCES', 'TRIGGER']) as p(privilege)
        group by t.name`,
      [[...SCHEDULING_TABLES, 'memberships']],
    );
    const change = ['INSERT', 'SELECT', 'UPDATE'];
    const changeAndDelete = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
    expect(Object.fromEntries(rows.map((row) => [row.table_name, row.privileges]))).toEqual({
      providers: change,
      provider_breaks: changeAndDelete,
      treatment_types: change,
      patients: change,
      appointments: change,
      clinic_hours: changeAndDelete,
      closed_days: changeAndDelete,
      // Still read-only: nobody links a person to a provider from the app yet (E01-T09, E04).
      memberships: ['SELECT'],
    });
  });
});

describe('without a clinic set', () => {
  it.each(SCHEDULING_TABLES)('the app role sees no row of %s and adds none', async (table) => {
    expect((await appWithoutTenant.query(`select id from ${table}`)).rows).toEqual([]);
    await expectPgError(
      insertRow(appWithoutTenant, table, validRow(table, a, 4)),
      PG.insufficientPrivilege,
    );
  });
});
