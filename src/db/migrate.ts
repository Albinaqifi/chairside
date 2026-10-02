// Applies pending SQL migrations (src/db/migrations) as the migration role: `pnpm db:migrate`.
// Node runs this file directly, without a build step. Import only packages and relative `.ts`
// files that follow the same rule, never `@/` paths.
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { requiredEnv } from './required-env.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/** Applies every migration not yet applied, all in one transaction. */
export async function runMigrations(migratorUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: migratorUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  await runMigrations(requiredEnv('MIGRATION_DATABASE_URL'));
  console.log('Migrations applied.');
}
