import { afterAll, describe, expect, it } from 'vitest';
import { appPool, expectPgError, PG } from './fixtures';

// The app connects as a role that cannot bypass Row-Level Security and cannot change the schema.
const app = appPool();
afterAll(() => app.end());

describe('the app role', () => {
  it('is not a superuser and cannot bypass Row-Level Security, create roles or databases', async () => {
    const { rows } = await app.query(
      `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       from pg_roles where rolname = current_user`,
    );
    expect(rows).toEqual([
      { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
    ]);
  });

  it('owns no tables, so policies always apply to it', async () => {
    const { rows } = await app.query(
      `select count(*)::int as owned from pg_class where relowner = (
         select oid from pg_roles where rolname = current_user)`,
    );
    expect(rows[0].owned).toBe(0);
  });

  it('cannot create, alter or drop tables', async () => {
    await expectPgError(app.query('create table app_made (id int)'), PG.insufficientPrivilege);
    await expectPgError(
      app.query('alter table clinics add column app_made int'),
      PG.insufficientPrivilege,
    );
    await expectPgError(app.query('drop table audit_log'), PG.insufficientPrivilege);
  });

  it('cannot switch Row-Level Security off', async () => {
    await expectPgError(
      app.query('alter table clinics disable row level security'),
      PG.insufficientPrivilege,
    );
    const client = await app.connect();
    try {
      await client.query('set row_security = off');
      await expectPgError(client.query('select id from clinics'), PG.insufficientPrivilege);
    } finally {
      client.release();
    }
  });

  it('cannot read the migration journal', async () => {
    await expectPgError(
      app.query('select * from drizzle.__drizzle_migrations'),
      PG.insufficientPrivilege,
    );
  });
});
