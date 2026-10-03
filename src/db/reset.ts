// Rebuilds a LOCAL database from nothing: creates or updates the two database roles, drops and
// recreates the database, then applies every migration. Used by `pnpm db:reset` and by the
// integration tests. It refuses to touch a database that is not on this machine.
// Node runs this file directly: import only packages and relative `.ts` files (see migrate.ts).
import pg from 'pg';
import { runMigrations } from './migrate.ts';
import { requiredEnv } from './required-env.ts';

/** The role the migrations grant table access to. */
const APP_ROLE = 'chairside_app';
/** This machine, as pg names the host it connects to (it drops the brackets of `[::1]`). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface DatabaseUrls {
  /** A superuser connection, used to create roles and databases. */
  adminUrl: string;
  /** The migration role: owns the database and everything the migrations create. */
  migratorUrl: string;
  /** The app role: owns nothing, cannot bypass Row-Level Security. */
  appUrl: string;
}

/** Where pg will really connect, and as whom. */
export interface ConnectionTarget {
  host: string;
  user: string;
  password: string;
  database: string;
}

/**
 * What pg will really use for a connection string. Query parameters such as `?host=` and
 * `?user=` win over the URL's own parts, and PG* environment variables fill in missing ones, so
 * the URL's parts alone cannot be trusted. Creating a Client does not connect.
 */
export function connectionTarget(url: string): ConnectionTarget {
  const client = new pg.Client({ connectionString: url });
  return {
    host: client.host,
    user: client.user ?? '',
    password: client.password ?? '',
    database: client.database ?? '',
  };
}

/**
 * The guard, run before anything connects: all three connections go to this machine, never
 * with NODE_ENV=production, the migration role and the app role use the same database, and the
 * app connects as the role the migrations grant access to. Throws if any of that is not so.
 */
export function checkResetTargets({ adminUrl, migratorUrl, appUrl }: DatabaseUrls): {
  migrator: ConnectionTarget;
  app: ConnectionTarget;
} {
  const migrator = connectionTarget(migratorUrl);
  const app = connectionTarget(appUrl);
  for (const { host } of [connectionTarget(adminUrl), migrator, app]) {
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`Refusing to reset a database on "${host}": only local ones.`);
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a database when NODE_ENV is production.');
  }
  if (!migrator.database || migrator.database !== app.database) {
    throw new Error('MIGRATION_DATABASE_URL and DATABASE_URL must name the same database.');
  }
  if (app.user !== APP_ROLE) {
    throw new Error(`DATABASE_URL must connect as ${APP_ROLE}: the migrations grant access to it.`);
  }
  return { migrator, app };
}

export async function resetDatabase(urls: DatabaseUrls): Promise<void> {
  const { migrator, app } = checkResetTargets(urls);

  const admin = new pg.Client({ connectionString: urls.adminUrl });
  await admin.connect();
  try {
    await upsertRole(admin, migrator, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
    await upsertRole(admin, app, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT');
    const name = pg.escapeIdentifier(migrator.database);
    const owner = pg.escapeIdentifier(migrator.user);
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name} OWNER ${owner}`);
  } finally {
    await admin.end();
  }
  await runMigrations(urls.migratorUrl);
}

/** Creates the role, or updates its password and attributes if it exists. */
async function upsertRole(
  admin: pg.Client,
  { user, password }: ConnectionTarget,
  attributes: string,
): Promise<void> {
  if (!user || !password) throw new Error('Database URLs must include a user name and password.');
  const existing = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [user]);
  const verb = existing.rowCount ? 'ALTER' : 'CREATE';
  await admin.query(
    `${verb} ROLE ${pg.escapeIdentifier(user)} WITH LOGIN ${attributes} PASSWORD ${pg.escapeLiteral(password)}`,
  );
}

if (import.meta.main) {
  const appUrl = requiredEnv('DATABASE_URL');
  await resetDatabase({
    adminUrl: requiredEnv('DATABASE_ADMIN_URL'),
    migratorUrl: requiredEnv('MIGRATION_DATABASE_URL'),
    appUrl,
  });
  console.log(`Database "${connectionTarget(appUrl).database}" rebuilt from migrations.`);
}
