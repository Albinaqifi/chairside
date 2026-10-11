import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getConstructionPlans } from 'pg-boss';
import { describe, expect, it } from 'vitest';

// E00-T07b, acceptance 1 (D-104): migration 0005 is the SQL the installed pg-boss gives for its schema,
// with two changes only, then the grants. Read against pg-boss itself, so an upgrade that changes its
// SQL fails here: an upgrade is a new migration, from its getMigrationPlans() (docs/runbook.md).

const MIGRATION = fs.readFileSync(new URL('./migrations/0005_pgboss.sql', import.meta.url), 'utf8');
const pgBoss = createRequire(import.meta.url)('pg-boss/package.json') as {
  version: string;
  pgboss: { schema: number };
};

/** The migration's statements: pg-boss's SQL after the header's comment lines, then the grants. */
const [first = '', ...grants] = MIGRATION.split('\n--> statement-breakpoint\n');
const header = /^(--.*\n)*/.exec(first)?.[0] ?? '';
const pgBossPart = first.slice(header.length);

/**
 * pg-boss's SQL as the migration holds it: without its `BEGIN;` and `COMMIT;` lines, and without the
 * DO block, and the blank line before it, that makes queue_stats' partitions named after the day.
 */
function asMigrated(plans: string): string {
  const lines = plans.split('\n');
  const only = (line: string) => {
    const at = lines.indexOf(line);
    expect(at, line).toBeGreaterThan(-1);
    expect(lines.indexOf(line, at + 1), `${line} once`).toBe(-1);
    return at;
  };
  lines.splice(only('    BEGIN;'), 1);
  lines.splice(only('    COMMIT;'), 1);
  const start = only('    DO $$');
  const end = lines.indexOf('  ;', start);
  expect(lines.slice(start, end).join('\n')).toContain("'queue_stats_' || to_char(d, 'YYYYMMDD')");
  expect(lines[start - 1]).toBe('');
  lines.splice(start - 1, end - start + 2);
  return lines.join('\n');
}

describe("migration 0005, the job queue's schema", () => {
  it('is for pg-boss 12.37.1 exactly, whose schema is version 45', () => {
    expect(pgBoss.version).toBe('12.37.1');
    expect(pgBoss.pgboss.schema).toBe(45);
    expect(pgBossPart).toContain("INSERT INTO pgboss.version(version) VALUES ('45');");
  });

  it("holds pg-boss's SQL for the schema without its BEGIN; and COMMIT; and the dated partitions, nothing else changed", () => {
    expect(header).toMatch(/^-- E00-T07b/);
    expect(pgBossPart).toBe(asMigrated(getConstructionPlans('pgboss')));
  });

  it('holds no transaction of its own and makes no table named after a day', () => {
    // A transaction statement, not a plpgsql block's BEGIN (no semicolon) or END; (which closes it).
    expect(pgBossPart).not.toMatch(/^\s*(BEGIN|START TRANSACTION|COMMIT|ROLLBACK)\s*;/im);
    expect(pgBossPart).not.toContain("queue_stats_' ||");
    expect(pgBossPart).not.toMatch(/\bDO \$\$/);
  });

  it("then grants the app role the schema's use and the rows of seven tables, nothing more", () => {
    expect(grants).toEqual([
      'GRANT USAGE ON SCHEMA pgboss TO chairside_app;',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.version, pgboss.queue, pgboss.schedule, ' +
        'pgboss.job, pgboss.job_common, pgboss.job_dependency, pgboss.instance TO chairside_app;\n',
    ]);
  });
});
