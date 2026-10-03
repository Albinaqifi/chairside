import { afterAll, describe, expect, it } from 'vitest';
import { migratorPool } from './fixtures';
import { CROSS_CLINIC_FUNCTIONS, GLOBAL_TABLES, TENANT_ROOT_TABLES } from './tenant-allow-list';

// The meta-test: every table in the database follows the tenant rules, or is on the allow-list.

interface TableInfo {
  table: string;
  rlsEnabled: boolean;
  columns: Record<string, { type: string; notNull: boolean }>;
  policies: { name: string; using: string | null; check: string | null }[];
}

/** Every table in every non-system schema, except tables that belong to an extension. */
const TABLES_QUERY = `
  select
    n.nspname || '.' || c.relname as "table",
    c.relrowsecurity as "rlsEnabled",
    coalesce((
      select json_object_agg(a.attname, json_build_object(
        'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull))
      from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and a.attname in ('id', 'clinic_id')
    ), '{}') as "columns",
    coalesce((
      select json_agg(json_build_object(
        'name', p.polname,
        'using', pg_get_expr(p.polqual, p.polrelid),
        'check', pg_get_expr(p.polwithcheck, p.polrelid)))
      from pg_policy p
      where p.polrelid = c.oid
    ), '[]') as "policies"
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\\_%'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  order by 1`;

/** Lists every way the tables break the tenant rules. Empty means all is well. */
function tenantProblems(tables: TableInfo[]): string[] {
  const problems: string[] = [];
  const names = new Set(tables.map((t) => t.table));
  for (const listed of [...Object.keys(GLOBAL_TABLES), ...Object.keys(TENANT_ROOT_TABLES)]) {
    if (!names.has(listed)) problems.push(`${listed}: on the allow-list but no such table exists`);
  }

  for (const { table, rlsEnabled, columns, policies } of tables) {
    if (table in GLOBAL_TABLES) continue;
    const column = table in TENANT_ROOT_TABLES ? 'id' : 'clinic_id';
    const info = columns[column];
    if (!info) problems.push(`${table}: has no ${column} column`);
    else if (info.type !== 'uuid' || !info.notNull) {
      problems.push(`${table}: ${column} must be "uuid not null", is "${info.type}"`);
    }
    if (!rlsEnabled) problems.push(`${table}: Row-Level Security is not enabled`);
    if (policies.length === 0) problems.push(`${table}: has no policy`);
    // PostgreSQL prints a policy as `(clinic_id = current_clinic_id())`, and a narrower one as
    // `((clinic_id = current_clinic_id()) AND ...)`. Anything else (OR, NOT, another column whose
    // name ends in clinic_id) could let other clinics' rows through.
    const comparison = `(${column} = current_clinic_id())`;
    for (const policy of policies) {
      for (const expression of [policy.using, policy.check]) {
        if (expression === null) continue;
        if (!expression.includes(comparison)) {
          problems.push(
            `${table}: policy ${policy.name} must compare ${column} with current_clinic_id(), has ${expression}`,
          );
        } else if (expression !== comparison && !expression.startsWith(`(${comparison} AND `)) {
          problems.push(
            `${table}: policy ${policy.name} may only narrow ${comparison} with AND, has ${expression}`,
          );
        }
      }
    }
  }
  return problems;
}

interface BypassInfo {
  name: string;
  kind: 'view' | 'materialized view' | 'function';
  /** True when it reads rows with its owner's rights, which Row-Level Security does not limit. */
  runsAsOwner: boolean;
}

/**
 * Views, materialized views and functions in every non-system schema, except those that belong
 * to an extension. A view without `security_invoker`, any materialized view and a SECURITY
 * DEFINER function read tables as their owner, and the owner is not limited by the policies.
 */
const BYPASS_QUERY = `
  select
    n.nspname || '.' || c.relname as "name",
    case c.relkind when 'v' then 'view' else 'materialized view' end as "kind",
    c.relkind = 'm' or not coalesce((
      select o.option_value::boolean from pg_options_to_table(c.reloptions) o
      where o.option_name = 'security_invoker'), false) as "runsAsOwner"
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\\_%'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  union all
  select n.nspname || '.' || p.proname, 'function', p.prosecdef
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\\_%'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  order by 1`;

/** Lists every view and function that could get around Row-Level Security. Empty means none. */
function bypassProblems(
  objects: BypassInfo[],
  allowed: Readonly<Record<string, string>> = CROSS_CLINIC_FUNCTIONS,
): string[] {
  const problems: string[] = [];
  const functions = new Set(objects.filter((o) => o.kind === 'function').map((o) => o.name));
  for (const listed of Object.keys(allowed)) {
    if (!functions.has(listed)) {
      problems.push(`${listed}: on the allow-list but no such function exists`);
    }
  }

  for (const { name, kind, runsAsOwner } of objects) {
    if (kind === 'materialized view') {
      problems.push(`${name}: a materialized view cannot have Row-Level Security`);
    } else if (kind === 'view' && runsAsOwner) {
      problems.push(`${name}: a view must be created WITH (security_invoker = true)`);
    } else if (kind === 'function' && runsAsOwner && !(name in allowed)) {
      problems.push(`${name}: a SECURITY DEFINER function must be in CROSS_CLINIC_FUNCTIONS`);
    }
  }
  return problems;
}

describe('meta-test: tenant rules on every table', () => {
  const db = migratorPool();
  afterAll(() => db.end());

  it('every table has clinic_id, Row-Level Security and a clinic policy, or is allow-listed', async () => {
    const { rows } = await db.query<TableInfo>(TABLES_QUERY);

    // Guards against a broken query passing silently by finding nothing.
    expect(rows.map((r) => r.table)).toEqual(
      expect.arrayContaining([
        'public.clinics',
        'public.audit_log',
        'drizzle.__drizzle_migrations',
      ]),
    );
    expect(tenantProblems(rows)).toEqual([]);
  });

  it('no view, materialized view or SECURITY DEFINER function gets around the policies', async () => {
    const { rows } = await db.query<BypassInfo>(BYPASS_QUERY);

    // Guards against a broken query passing silently by finding nothing.
    expect(rows).toContainEqual({
      name: 'public.current_clinic_id',
      kind: 'function',
      runsAsOwner: false,
    });
    expect(bypassProblems(rows)).toEqual([]);
  });

  it('catches a widened policy and each way around the policies in a real database', async () => {
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(`
        create table meta_probe_widened (id uuid primary key, clinic_id uuid not null);
        alter table meta_probe_widened enable row level security;
        create policy p on meta_probe_widened using (clinic_id = current_clinic_id() or true);
        create view meta_probe_view as select id from clinics;
        create view meta_probe_invoker_view with (security_invoker = true) as select id from clinics;
        create materialized view meta_probe_matview as select id from clinics;
        create function meta_probe_definer() returns setof uuid
          language sql security definer as 'select id from clinics';`);

      const tables = await client.query<TableInfo>(TABLES_QUERY);
      expect(tenantProblems(tables.rows)).toEqual([
        'public.meta_probe_widened: policy p may only narrow (clinic_id = current_clinic_id()) with AND, has ((clinic_id = current_clinic_id()) OR true)',
      ]);
      const objects = await client.query<BypassInfo>(BYPASS_QUERY);
      expect(bypassProblems(objects.rows)).toEqual([
        'public.meta_probe_definer: a SECURITY DEFINER function must be in CROSS_CLINIC_FUNCTIONS',
        'public.meta_probe_matview: a materialized view cannot have Row-Level Security',
        'public.meta_probe_view: a view must be created WITH (security_invoker = true)',
      ]);
    } finally {
      // Nothing created here survives the test.
      await client.query('rollback');
      client.release();
    }
  });
});

describe('meta-test rules', () => {
  const tenantTable: TableInfo = {
    table: 'public.example',
    rlsEnabled: true,
    columns: { id: { type: 'uuid', notNull: true }, clinic_id: { type: 'uuid', notNull: true } },
    policies: [
      {
        name: 'p',
        using: '(clinic_id = current_clinic_id())',
        check: '(clinic_id = current_clinic_id())',
      },
    ],
  };
  // Every allow-listed table exists in this made-up database, so only the example table is under test.
  const known: TableInfo[] = [
    ...Object.keys(TENANT_ROOT_TABLES).map((table) => ({
      ...tenantTable,
      table,
      policies: [{ name: 'p', using: '(id = current_clinic_id())', check: null }],
    })),
    ...Object.keys(GLOBAL_TABLES).map((table) => ({
      ...tenantTable,
      table,
      rlsEnabled: false,
      policies: [],
    })),
  ];
  const problemsWith = (table: Partial<TableInfo>) =>
    tenantProblems([...known, { ...tenantTable, ...table }]);

  it('accepts a correct tenant table', () => {
    expect(problemsWith({})).toEqual([]);
  });

  it('reports a table without clinic_id', () => {
    expect(problemsWith({ columns: { id: { type: 'uuid', notNull: true } } })).toEqual([
      'public.example: has no clinic_id column',
    ]);
  });

  it('reports a nullable or non-uuid clinic_id', () => {
    expect(problemsWith({ columns: { clinic_id: { type: 'uuid', notNull: false } } })).toHaveLength(
      1,
    );
    expect(problemsWith({ columns: { clinic_id: { type: 'text', notNull: true } } })).toHaveLength(
      1,
    );
  });

  it('reports a table without Row-Level Security', () => {
    expect(problemsWith({ rlsEnabled: false })).toEqual([
      'public.example: Row-Level Security is not enabled',
    ]);
  });

  it('reports a table without a policy', () => {
    expect(problemsWith({ policies: [] })).toEqual(['public.example: has no policy']);
  });

  it('reports a policy that does not limit rows to the current clinic', () => {
    expect(problemsWith({ policies: [{ name: 'open', using: 'true', check: null }] })).toEqual([
      'public.example: policy open must compare clinic_id with current_clinic_id(), has true',
    ]);
  });

  it('reports an allow-list entry for a table that does not exist', () => {
    const withoutClinics = known.filter((table) => table.table !== 'public.clinics');
    expect(tenantProblems([...withoutClinics, tenantTable])).toEqual([
      'public.clinics: on the allow-list but no such table exists',
    ]);
  });

  const policy = (using: string) => ({ policies: [{ name: 'p', using, check: null }] });

  it('reports a policy widened with OR or turned around with NOT', () => {
    expect(problemsWith(policy('((clinic_id = current_clinic_id()) OR true)'))).toEqual([
      'public.example: policy p may only narrow (clinic_id = current_clinic_id()) with AND, has ((clinic_id = current_clinic_id()) OR true)',
    ]);
    expect(problemsWith(policy('(NOT (clinic_id = current_clinic_id()))'))).toHaveLength(1);
    expect(
      problemsWith(policy("(((clinic_id = current_clinic_id()) AND (x = 'y'::text)) OR true)")),
    ).toHaveLength(1);
  });

  it('reports a policy on another column whose name ends in clinic_id', () => {
    expect(problemsWith(policy('(other_clinic_id = current_clinic_id())'))).toEqual([
      'public.example: policy p must compare clinic_id with current_clinic_id(), has (other_clinic_id = current_clinic_id())',
    ]);
  });

  it('accepts a policy narrowed with AND', () => {
    expect(
      problemsWith(policy("((clinic_id = current_clinic_id()) AND (status = 'active'::text))")),
    ).toEqual([]);
  });
});

describe('meta-test rules: views and functions', () => {
  const ordinary: BypassInfo = {
    name: 'public.current_clinic_id',
    kind: 'function',
    runsAsOwner: false,
  };

  it('accepts security_invoker views and ordinary functions', () => {
    expect(
      bypassProblems([ordinary, { name: 'public.v', kind: 'view', runsAsOwner: false }], {}),
    ).toEqual([]);
  });

  it('reports a view without security_invoker and any materialized view', () => {
    expect(
      bypassProblems(
        [
          { name: 'public.v', kind: 'view', runsAsOwner: true },
          { name: 'public.m', kind: 'materialized view', runsAsOwner: true },
        ],
        {},
      ),
    ).toEqual([
      'public.v: a view must be created WITH (security_invoker = true)',
      'public.m: a materialized view cannot have Row-Level Security',
    ]);
  });

  it('reports a SECURITY DEFINER function unless it is allow-listed', () => {
    const definer: BypassInfo = { name: 'public.resolve', kind: 'function', runsAsOwner: true };
    expect(bypassProblems([definer], {})).toEqual([
      'public.resolve: a SECURITY DEFINER function must be in CROSS_CLINIC_FUNCTIONS',
    ]);
    expect(bypassProblems([definer], { 'public.resolve': 'reason' })).toEqual([]);
  });

  it('reports an allow-list entry for a function that does not exist', () => {
    expect(bypassProblems([ordinary], { 'public.gone': 'reason' })).toEqual([
      'public.gone: on the allow-list but no such function exists',
    ]);
  });
});
