// Rebuilds a LOCAL database from nothing: creates or updates the two database roles, drops and
// recreates the database, then applies every migration. Used by `pnpm db:reset`, which then runs
// the seed (src/db/seed), and by the integration tests, which get the migrations only. It refuses
// to touch a database that is not on this machine.
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
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * What pg will really use for a connection string. Query parameters such as `?host=`, `?port=`
 * and `?user=` win over the URL's own parts, and PG* environment variables fill in missing ones,
 * so the URL's parts alone cannot be trusted. Creating a Client does not connect.
 */
export function connectionTarget(url: string): ConnectionTarget {
  const client = new pg.Client({ connectionString: url });
  return {
    host: client.host,
    port: client.port,
    user: client.user ?? '',
    password: client.password ?? '',
    database: client.database ?? '',
  };
}

/** The connections a script opens to a local database: `db:reset` all three, `db:seed` two. */
export interface LocalDatabaseUrls {
  adminUrl?: string;
  migratorUrl: string;
  appUrl: string;
}

/** The guard of `pnpm db:reset`, run before anything connects: checkLocalTargets() on its three. */
export function checkResetTargets(urls: DatabaseUrls): {
  migrator: ConnectionTarget;
  app: ConnectionTarget;
} {
  return checkLocalTargets('reset', urls);
}

/**
 * The guard of the scripts that write to a local database, `pnpm db:reset` and `pnpm db:seed`
 * (whose logins share a password written in README.md), run before anything connects: every
 * connection goes to this machine and to one database server on it (the same host and port), never
 * with NODE_ENV=production, the migration role and the app role use the same database, and the app
 * connects as the role the migrations grant access to. Throws if any of that is not so; `action`
 * names the script in the message.
 */
export function checkLocalTargets(
  action: 'reset' | 'seed',
  { adminUrl, migratorUrl, appUrl }: LocalDatabaseUrls,
): { migrator: ConnectionTarget; app: ConnectionTarget } {
  // In the order messages name the variables: the admin connection first, when there is one.
  const admin =
    adminUrl === undefined
      ? []
      : [{ variable: 'DATABASE_ADMIN_URL', ...connectionTarget(adminUrl) }];
  const migrator = connectionTarget(migratorUrl);
  const app = connectionTarget(appUrl);
  const targets = [
    ...admin,
    { variable: 'MIGRATION_DATABASE_URL', ...migrator },
    { variable: 'DATABASE_URL', ...app },
  ];
  for (const { host } of targets) {
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`Refusing to ${action} a database on "${host}": only local ones.`);
    }
  }
  // Another server on this machine, such as a second PostgreSQL on another port, is never
  // touched: the roles, the dropped database, the migrations and the seed must all be on the
  // same one.
  const servers = targets.map(
    ({ host, port }) => `${host.includes(':') ? `[${host}]` : host}:${port}`,
  );
  if (new Set(servers).size !== 1) {
    // "A, B and C", or "B and C" without the admin connection.
    const variables = targets.map(({ variable }) => variable);
    const named = `${variables.slice(0, -1).join(', ')} and ${variables.slice(-1).join('')}`;
    throw new Error(
      `Refusing to ${action}: ${named} must name the same host and port ` +
        `(they name ${servers.join(', ')}).`,
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Refusing to ${action} a database when NODE_ENV is production.`);
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
