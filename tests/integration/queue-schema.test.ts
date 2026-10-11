import type pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { newId } from '@/lib/ids';
import { appPool, expectPgError, migratorPool, PG } from './fixtures';

// E00-T07b, acceptance 1 and 2: the job queue's schema, `pgboss`, as migration 0005 makes it, and what
// the app role can do there: read and write the rows of the seven tables the worker uses, and create,
// change, drop or truncate nothing, as database-roles.test.ts shows for `public`. That every one of its
// tables is on GLOBAL_TABLES: the meta-test, tenant-tables.test.ts.

const migrator = migratorPool();
const app = appPool();

afterAll(async () => {
  await app.end();
  await migrator.end();
});

/** The tables the worker uses, whose rows the app role reads and writes. */
const USED = ['instance', 'job', 'job_common', 'job_dependency', 'queue', 'schedule', 'version'];
/** pg-boss's other tables: nothing for the app role. */
const UNUSED = ['bam', 'queue_stats', 'subscription', 'warning'];

describe("migration 0005: the job queue's schema", () => {
  it('is made by the migration role, which owns the schema and everything in it', async () => {
    const { rows } = await migrator.query<{ kind: string; owner: string }>(`
      select 'schema' as kind, nspowner::regrole::text as owner from pg_namespace where nspname = 'pgboss'
      union all
      select 'relation', relowner::regrole::text from pg_class where relnamespace = 'pgboss'::regnamespace
      union all
      select 'function', proowner::regrole::text from pg_proc where pronamespace = 'pgboss'::regnamespace
      union all
      select 'type', typowner::regrole::text from pg_type where typnamespace = 'pgboss'::regnamespace`);
    expect(rows.filter((row) => row.kind === 'function')).toHaveLength(6);
    expect(new Set(rows.map((row) => row.kind))).toEqual(
      new Set(['schema', 'relation', 'function', 'type']),
    );
    expect(new Set(rows.map((row) => row.owner))).toEqual(new Set(['chairside_migrator']));
  });

  it('is at version 45, with eleven tables under fixed names: none named after a day', async () => {
    const version = await migrator.query('select version from pgboss.version');
    expect(version.rows).toEqual([{ version: 45 }]);
    const { rows } = await migrator.query<{ name: string; kind: string }>(`
      select relname as name, relkind as kind from pg_class
       where relnamespace = 'pgboss'::regnamespace and relkind in ('r', 'p') order by 1`);
    expect(rows).toEqual(
      [...USED, ...UNUSED].sort().map((name) => ({
        name,
        kind: name === 'job' || name === 'queue_stats' ? 'p' : 'r',
      })),
    );
    const partitions = await migrator.query(`
      select inhrelid::regclass::text as partition, inhparent::regclass::text as parent
        from pg_inherits where inhparent in ('pgboss.job'::regclass, 'pgboss.queue_stats'::regclass)`);
    expect(partitions.rows).toEqual([{ partition: 'pgboss.job_common', parent: 'pgboss.job' }]);
  });

  it('has no function that runs with its owner’s rights', async () => {
    const { rows } = await migrator.query(
      `select proname from pg_proc where pronamespace = 'pgboss'::regnamespace and prosecdef`,
    );
    expect(rows).toEqual([]);
  });
});

describe('the app role in the pgboss schema', () => {
  it('may use the schema, and create nothing in it', async () => {
    const { rows } = await app.query(`
      select has_schema_privilege('pgboss', 'USAGE') as usage,
             has_schema_privilege('pgboss', 'CREATE') as "create"`);
    expect(rows).toEqual([{ usage: true, create: false }]);
  });

  it('may read and write the rows of the seven tables the worker uses, and has no other right on any table', async () => {
    const PRIVILEGES = [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
    ];
    const { rows } = await app.query<{ table: string; privilege: string; held: boolean }>(
      `select c.relname as "table", p as privilege, has_table_privilege(c.oid, p) as held
         from pg_class c cross join unnest($1::text[]) as p
        where c.relnamespace = 'pgboss'::regnamespace and c.relkind in ('r', 'p')`,
      [PRIVILEGES],
    );
    const held = rows.filter((row) => row.held).map((row) => `${row.table} ${row.privilege}`);
    expect(held.sort()).toEqual(
      USED.flatMap((table) =>
        ['DELETE', 'INSERT', 'SELECT', 'UPDATE'].map((privilege) => `${table} ${privilege}`),
      ).sort(),
    );
  });

  it('reads and writes those rows', async () => {
    const queue = `probe-${newId().slice(-12)}`;
    await asAppInTransaction(async (client) => {
      await client.query(`select pgboss.create_queue($1, '{"policy": "standard"}')`, [queue]);
      const job = await client.query<{ id: string }>(
        `insert into pgboss.job (name, data) values ($1, '{"clinicId": "c"}') returning id`,
        [queue],
      );
      const id = job.rows[0]?.id;
      await client.query(`update pgboss.job set state = 'active' where name = $1 and id = $2`, [
        queue,
        id,
      ]);
      const common = await client.query(`select state from pgboss.job_common where id = $1`, [id]);
      expect(common.rows).toEqual([{ state: 'active' }]);
      await client.query(
        `insert into pgboss.job_dependency (child_name, child_id, parent_name, parent_id)
         values ($1, gen_random_uuid(), $1, $2)`,
        [queue, id],
      );
      await client.query(`delete from pgboss.job_dependency where parent_id = $1`, [id]);
      await client.query(`delete from pgboss.job where name = $1 and id = $2`, [queue, id]);
      await client.query(`insert into pgboss.schedule (name, cron) values ($1, '* * * * *')`, [
        queue,
      ]);
      await client.query(`update pgboss.schedule set cron = '0 * * * *' where name = $1`, [queue]);
      await client.query(`delete from pgboss.schedule where name = $1`, [queue]);
      await client.query(`update pgboss.version set cron_on = pgboss.job_now()`);
      await client.query(
        `insert into pgboss.instance (id, host, pid, version, node_version, heartbeat_seconds,
           supervise, schedule, migrate, persist_queue_stats, persist_warnings)
         values (gen_random_uuid(), 'probe', 1, '12.37.1', 'v24', 30, true, true, false, false, false)`,
      );
      await client.query(`delete from pgboss.instance where host = 'probe'`);
      await client.query(`delete from pgboss.queue where name = $1`, [queue]);
    });
  });

  it.each(UNUSED)('can neither read nor write pgboss.%s', async (table) => {
    await expectPgError(app.query(`select * from pgboss.${table}`), PG.insufficientPrivilege);
    await expectPgError(app.query(`delete from pgboss.${table}`), PG.insufficientPrivilege);
  });

  it.each([
    { does: 'creates a table', sql: 'create table pgboss.app_made (id int)' },
    {
      does: 'creates a partition, as a partitioned queue would',
      sql: `create table pgboss.app_made partition of pgboss.job for values in ('app_made')`,
    },
    {
      does: 'makes a partitioned queue, which makes its own table',
      sql: `select pgboss.create_queue('app_made', '{"policy": "standard", "partition": true}')`,
    },
    {
      does: 'creates a queue statistics partition, as persistQueueStats would',
      sql: `create table pgboss.queue_stats_20260101 partition of pgboss.queue_stats
              for values from ('2026-01-01') to ('2026-01-02')`,
    },
    { does: 'adds a column', sql: 'alter table pgboss.job add column app_made int' },
    { does: 'creates an index', sql: 'create index app_made on pgboss.job_common (name)' },
    { does: 'rebuilds an index, as reindex would', sql: 'reindex index pgboss.job_common_i11' },
    {
      does: "replaces job_now(), as pg-boss's TestClock would",
      sql: `create or replace function pgboss.job_now() returns timestamptz language sql as 'select now()'`,
    },
    {
      does: 'creates a function',
      sql: `create function pgboss.app_made() returns int language sql as 'select 1'`,
    },
    { does: 'adds a value to job_state', sql: `alter type pgboss.job_state add value 'app_made'` },
    { does: 'drops a table', sql: 'drop table pgboss.job_common' },
    { does: 'drops a function', sql: 'drop function pgboss.job_now()' },
    { does: 'truncates the jobs', sql: 'truncate pgboss.job' },
    { does: 'truncates the default partition', sql: 'truncate pgboss.job_common' },
    { does: 'renames the schema', sql: 'alter schema pgboss rename to app_made' },
    { does: 'drops the schema', sql: 'drop schema pgboss cascade' },
  ])('is refused when it $does', async ({ sql }) => {
    await asAppInTransaction(async (client) => {
      await expectPgError(client.query(sql), PG.insufficientPrivilege);
    });
  });
});

/** Runs `fn` as the app role in a transaction that is rolled back: nothing it does stays. */
async function asAppInTransaction(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await app.connect();
  try {
    await client.query('begin');
    await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}
