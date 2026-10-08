import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { e2eDatabase } from './tests/e2e/e2e-database.ts';
import { APP, APP_PORT, DEV, DEV_PORT, e2eEnv, FRONT_DESK_SESSION } from './tests/e2e/servers.ts';

// The end-to-end journeys (E00-T06b, D-100): `pnpm build`, then `pnpm test:e2e`, with the database
// up. CLAUDE.md, "CI", says how CI runs them and how to run them on Windows.

// Local settings come from .env (see .env.example), as for the other tests. Variables already set,
// as in CI, win.
try {
  process.loadEnvFile();
} catch {
  // No .env file: e2eDatabase() below says what is missing.
}

// On Windows, Playwright stops the servers with `taskkill`, called by its name. Where PATH lacks
// System32 (the owner's machine, 2026-10-08), the call fails without a word, both servers keep
// running and the run never ends: System32 goes back on PATH for this run.
if (process.platform === 'win32' && process.env.SystemRoot) {
  const system32 = path.join(process.env.SystemRoot, 'System32');
  const onPath = (process.env.PATH ?? '').split(path.delimiter);
  if (!onPath.some((dir) => dir.toLowerCase() === system32.toLowerCase())) {
    process.env.PATH = [...onPath.filter(Boolean), system32].join(path.delimiter);
  }
}

const database = e2eDatabase();

export default defineConfig({
  testDir: 'tests/e2e',
  // Rebuilds and seeds the run's database, then logs the front desk in once (global-setup.ts).
  globalSetup: './tests/e2e/global-setup.ts',
  // A journey that fails once is a finding, never retried.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    // The seeded front desk's session, on both servers; J1 and the signed-out pages leave it out.
    storageState: FRONT_DESK_SESSION,
    // Traces on failure only: in CI the step after the journeys uploads them (.github/workflows).
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The D-093 check's control serves /dev/components through Playwright (form-memory.spec.ts).
        // Chromium counts such a page as a public one and stops it from reaching `next dev` on this
        // machine (Local Network Access), so its script would never run. Every other page of a run
        // is on localhost already.
        launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Started before the global setup, which rebuilds their database: neither connects to it before
  // a test asks for a page. Never an existing server: it could be on another database.
  webServer: [
    {
      name: 'next start',
      command: `pnpm exec next start --port ${APP_PORT}`,
      url: `${APP}/login`,
      env: e2eEnv(database, APP),
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // /dev/components lives here: a production build answers 404 for it (E00-T04c).
      name: 'next dev',
      command: `pnpm exec next dev --port ${DEV_PORT}`,
      url: `${DEV}/login`,
      env: e2eEnv(database, DEV),
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
