import { requiredEnv } from '../../src/db/required-env.ts';
import type { DatabaseUrls } from '../../src/db/reset.ts';

/**
 * The end-to-end journeys use their own database: the one named in DATABASE_URL with `_e2e` added,
 * as the integration tests add `_test` (tests/integration/test-database.ts). Each run rebuilds it
 * and seeds it (global-setup.ts), so a run never touches development data. Roles and passwords are
 * the same.
 */
export interface E2eDatabase extends DatabaseUrls {
  name: string;
}

export function e2eDatabase(env: NodeJS.ProcessEnv = process.env): E2eDatabase {
  const adminUrl = requiredEnv('DATABASE_ADMIN_URL', env);
  const migratorUrl = new URL(requiredEnv('MIGRATION_DATABASE_URL', env));
  const appUrl = new URL(requiredEnv('DATABASE_URL', env));
  const base = appUrl.pathname.slice(1);
  const name = base.endsWith('_e2e') ? base : `${base}_e2e`;
  migratorUrl.pathname = `/${name}`;
  appUrl.pathname = `/${name}`;
  return { name, adminUrl, migratorUrl: migratorUrl.href, appUrl: appUrl.href };
}
