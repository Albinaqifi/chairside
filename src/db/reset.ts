// Rebuilds a LOCAL database from nothing: creates or updates the two database roles, drops and
// recreates the database, then applies every migration. Used by `pnpm db:reset` and by the
// integration tests. It refuses to touch a database that is not on this machine.
// Node runs this file directly: import only packages and relative `.ts` files (see migrate.ts).
import pg from 'pg';
import { runMigrations } from './migrate.ts';
import { requiredEnv } from './required-env.ts';

/** The role the migrations grant table access to. */
const APP_ROLE = 'chairside_app';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface DatabaseUrls {
  /** A superuser connection, used to create roles and databases. */
  adminUrl: string;
  /** The migration role: owns the database and everything the migrations create. */
  migratorUrl: string;
  /** The app role: owns nothing, cannot bypass Row-Level Security. */
  appUrl: string;
}

export async function resetDatabase({
  adminUrl,
  migratorUrl,
  appUrl,
}: DatabaseUrls): Promise<void> {
  const migrator = new URL(migratorUrl);
  const app = new URL(appUrl);
  for (const url of [new URL(adminUrl), migrator, app]) {
    if (!LOCAL_HOSTS.has(url.hostname)) {
      throw new Error(`Refusing to reset a database on "${url.hostname}": only local ones.`);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a database when NODE_ENV is production.');
  }
  const database = migrator.pathname.slice(1);
  if (!database || database !== app.pathname.slice(1)) {
    throw new Error('MIGRATION_DATABASE_URL and DATABASE_URL must name the same database.');
  }
  if (decodeURIComponent(app.username) !== APP_ROLE) {
    throw new Error(`DATABASE_URL must connect as ${APP_ROLE}: the migrations grant access to it.`);
  }

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await upsertRole(admin, migrator, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
    await upsertRole(admin, app, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT');
    const name = pg.escapeIdentifier(database);
    const owner = pg.escapeIdentifier(decodeURIComponent(migrator.username));
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`);
  } finally {
    await admin.end();
  }
  await runMigrations(migratorUrl);
}

/** Creates the role, or updates its password and attributes if it exists. */
async function upsertRole(admin: pg.Client, url: URL, attributes: string): Promise<void> {
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!role || !password) throw new Error('Database URLs must include a user name and password.');
  const existing = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const verb = existing.rowCount ? 'ALTER' : 'CREATE';
  await admin.query(
    `${verb} ROLE ${pg.escapeIdentifier(role)} WITH LOGIN ${attributes} PASSWORD ${pg.escapeLiteral(password)}`,
  );
}

if (import.meta.main) {
  const appUrl = requiredEnv('DATABASE_URL');
  await resetDatabase({
    adminUrl: requiredEnv('DATABASE_ADMIN_URL'),
    migratorUrl: requiredEnv('MIGRATION_DATABASE_URL'),
    appUrl,
  });
  console.log(`Database "${new URL(appUrl).pathname.slice(1)}" rebuilt from migrations.`);
}
