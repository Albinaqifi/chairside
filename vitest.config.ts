import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { testDatabaseEnv } from './tests/integration/test-database.ts';

// Local settings come from .env (see .env.example). Variables already set, as in CI, win.
try {
  process.loadEnvFile();
} catch {
  // No .env file: unit tests do not need one, integration tests say what is missing.
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'eslint-rules/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          env: testDatabaseEnv(process.env),
          // The test files share one database.
          fileParallelism: false,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
