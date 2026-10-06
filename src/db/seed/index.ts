// The seed (E00-T05a, D-090): fills a LOCAL database with synthetic clinics and a login for every
// role, and from later tasks their data, under the fixed ids of seeded.ts. `pnpm db:seed` runs this
// file with tsx, which lets it import `@/`: people are made with createStaffUser() (D-063), which
// plain Node cannot load. `pnpm db:reset` runs it after the migrations; E00-T06b's end-to-end
// database calls seedDatabase(). Its logins share a password written in README.md, so it refuses
// every database that is not on this machine, before it connects.
import pg from 'pg';
import { closeDb } from '@/db/client';
import { withoutQueryValues } from '@/lib/query-errors';
import { createStaffUser } from '@/modules/auth';
import { checkLocalTargets, connectionTarget, type LocalDatabaseUrls } from '../reset';
import { requiredEnv } from '../required-env';
import { SEED_FILES, type SeedFile, type SeedPerson, type SeedRow } from './seed-files';
import { SEED_PASSWORD } from './seeded';

/** The database the seed writes to: its own rows as the migration role, people as the app. */
export type SeedUrls = Pick<LocalDatabaseUrls, 'migratorUrl' | 'appUrl'>;

/** What one seed file added, by table, and people. Zero everywhere when it was there already. */
export interface SeedSummary {
  title: string;
  added: Record<string, number>;
}

/**
 * The seed's guard, run before anything connects: db:reset's (checkLocalTargets: this machine,
 * one server, never NODE_ENV=production, one database, the app as chairside_app). And DATABASE_URL
 * must name the same database as `appUrl`: createStaffUser() makes the people through
 * DATABASE_URL, so whatever database it names would get the logins.
 */
export function checkSeedTargets({ migratorUrl, appUrl }: SeedUrls): void {
  const { app } = checkLocalTargets('seed', { migratorUrl, appUrl });
  const people = connectionTarget(requiredEnv('DATABASE_URL'));
  const same = (['host', 'port', 'user', 'database'] as const).every(
    (part) => people[part] === app[part],
  );
  if (!same) {
    throw new Error(
      'Refusing to seed: DATABASE_URL must name the database being seeded, as its app role; ' +
        'createStaffUser() makes the people through it.',
    );
  }
}

/**
 * Writes every seed file, in order, into the database `urls` names, after checkSeedTargets(). A
 * row or a person whose id is there already is left as it is: on a database that holds the seed,
 * it adds nothing. The pool createStaffUser() used stays open for the caller, who ends it with
 * closeDb().
 */
export async function seedDatabase(urls: SeedUrls): Promise<SeedSummary[]> {
  checkSeedTargets(urls);
  const migrator = new pg.Client({ connectionString: urls.migratorUrl });
  await migrator.connect();
  try {
    const summaries: SeedSummary[] = [];
    for (const file of SEED_FILES) summaries.push(await writeSeedFile(migrator, file));
    return summaries;
  } finally {
    await migrator.end();
  }
}

/** Writes one seed file: its tables, then its people with their memberships. */
async function writeSeedFile(migrator: pg.Client, file: SeedFile): Promise<SeedSummary> {
  const added: Record<string, number> = {};
  const count = (what: string, rows: number) => {
    added[what] = (added[what] ?? 0) + rows;
  };
  for (const { table, rows } of file.tables ?? []) {
    for (const row of rows) count(table, await insertRow(migrator, table, row));
  }
  for (const person of file.people ?? []) {
    count('people', await addPerson(migrator, person));
    for (const membership of person.memberships) {
      const row = {
        id: membership.id,
        clinic_id: membership.clinicId,
        user_id: person.id,
        role: membership.role,
        extra_permissions: membership.extraPermissions,
      };
      count('memberships', await insertRow(migrator, 'memberships', row));
    }
  }
  return { title: file.title, added };
}

/**
 * Inserts the row as the migration role, which owns the tables: Row-Level Security does not hold
 * it, and it may write what the app role cannot (clinics, memberships). Returns 1 when the row was
 * added, 0 when a row with its id was there already.
 */
async function insertRow(migrator: pg.Client, table: string, row: SeedRow): Promise<number> {
  const columns = Object.keys(row);
  const names = columns.map((column) => pg.escapeIdentifier(column)).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const { rowCount } = await query(
    migrator,
    `insert into ${pg.escapeIdentifier(table)} (${names}) values (${placeholders})
     on conflict (id) do nothing`,
    Object.values(row),
  );
  return rowCount ?? 0;
}

/**
 * Makes the person under their fixed id with createStaffUser() (D-063), so the auth library hashes
 * the development password. Returns 1 when the person was added, 0 when a person with this id was
 * there already, who is left as they are. A database seeded before people had fixed ids holds
 * them under other ids: createStaffUser() then fails on the taken email, and `pnpm db:reset`
 * builds it again.
 */
async function addPerson(migrator: pg.Client, person: SeedPerson): Promise<number> {
  const { rowCount } = await query(migrator, 'select 1 from users where id = $1', [person.id]);
  if (rowCount) return 0;
  await createStaffUser({
    id: person.id,
    email: person.email,
    name: person.name,
    password: SEED_PASSWORD,
  });
  return 1;
}

/** A query whose error carries no values if it fails (D-070): the seed's are synthetic too. */
async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  client: pg.Client,
  text: string,
  values: readonly unknown[],
): Promise<pg.QueryResult<Row>> {
  try {
    return await client.query<Row>(text, [...values]);
  } catch (error) {
    throw withoutQueryValues(error);
  }
}

/** The line the seed prints for one file: what it added, never which rows. */
export function describeSummary({ title, added }: SeedSummary): string {
  const counts = Object.entries(added).filter(([, rows]) => rows > 0);
  if (counts.length === 0) return `Seed "${title}": there already, nothing added.`;
  return `Seed "${title}": added ${counts.map(([what, rows]) => `${rows} ${what}`).join(', ')}.`;
}

if (import.meta.main) {
  try {
    const summaries = await seedDatabase({
      migratorUrl: requiredEnv('MIGRATION_DATABASE_URL'),
      appUrl: requiredEnv('DATABASE_URL'),
    });
    for (const summary of summaries) console.log(describeSummary(summary));
  } finally {
    // The pool createStaffUser() used: open, it would keep the script from ending.
    await closeDb();
  }
}
