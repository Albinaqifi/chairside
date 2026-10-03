import { requiredEnv } from '../../src/db/required-env.ts';

/**
 * The integration tests use their own database: the one named in DATABASE_URL with `_test`
 * added. Running them never touches development data. Roles and passwords are the same.
 */
export interface TestDatabase {
  name: string;
  adminUrl: string;
  migratorUrl: string;
  appUrl: string;
}

export function testDatabase(env: NodeJS.ProcessEnv = process.env): TestDatabase {
  const adminUrl = requiredEnv('DATABASE_ADMIN_URL', env);
  const migratorUrl = new URL(requiredEnv('MIGRATION_DATABASE_URL', env));
  const appUrl = new URL(requiredEnv('DATABASE_URL', env));
  const base = appUrl.pathname.slice(1);
  const name = base.endsWith('_test') ? base : `${base}_test`;
  migratorUrl.pathname = `/${name}`;
  appUrl.pathname = `/${name}`;
  return { name, adminUrl, migratorUrl: migratorUrl.href, appUrl: appUrl.href };
}

/**
 * Environment for the test processes, so code under test connects to the test database.
 * Empty when the variables are missing: the global setup then says what to do.
 */
export function testDatabaseEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  try {
    const db = testDatabase(env);
    return { DATABASE_URL: db.appUrl, MIGRATION_DATABASE_URL: db.migratorUrl };
  } catch {
    return {};
  }
}
