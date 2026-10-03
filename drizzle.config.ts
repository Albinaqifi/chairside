import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from the tables in src/modules/*/schema.ts: `pnpm db:generate`.
// Migrations are applied by `pnpm db:migrate` (src/db/migrate.ts), not by drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
