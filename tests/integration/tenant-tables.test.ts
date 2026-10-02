import { afterAll, describe, expect, it } from 'vitest';
import { migratorPool } from './fixtures';
import { GLOBAL_TABLES, TENANT_ROOT_TABLES } from './tenant-allow-list';

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
    for (const policy of policies) {
      for (const expression of [policy.using, policy.check]) {
        if (expression !== null && !expression.includes(`${column} = current_clinic_id()`)) {
          problems.push(
            `${table}: policy ${policy.name} must compare ${column} with current_clinic_id(), has ${expression}`,
          );
        }
      }
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
  const known: TableInfo[] = [
    {
      ...tenantTable,
      table: 'public.clinics',
      policies: [{ name: 'p', using: '(id = current_clinic_id())', check: null }],
    },
    { ...tenantTable, table: 'drizzle.__drizzle_migrations', rlsEnabled: false, policies: [] },
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
    expect(tenantProblems([known[1]!, tenantTable])).toEqual([
      'public.clinics: on the allow-list but no such table exists',
    ]);
  });
});
