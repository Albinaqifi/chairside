import './tests/e2e/load-env.ts';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { e2eDatabase } from './tests/e2e/e2e-database.ts';
import { APP, APP_PORT, DEV, DEV_PORT, e2eEnv, FRONT_DESK_SESSION } from './tests/e2e/servers.ts';

// The end-to-end journeys (E00-T06b, D-100): `pnpm build`, then `pnpm test:e2e`, with the database
// up. CLAUDE.md, "CI", says how CI runs them and how to run them on Windows. Local settings come
// from .env, loaded by the first import above (load-env.ts).

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
  // A quarter of the logical cores, not Playwright's half: each worker runs a browser, and both
  // servers and the database share the machine with them. On a 16-thread machine, 8 workers made
  // every step about twice as slow as 4 did, for no shorter a run, and `next dev`'s pages now and then
  // outlasted their waits without a fault (E00-T06b tester, after fix round 2: the D-093 check after
  // Back). On CI's 2-core runner this is 1, as Playwright's default was.
  workers: '25%',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    // The seeded front desk's session, on both servers; J1 and the signed-out pages leave it out.
    storageState: FRONT_DESK_SESSION,
    // Traces on failure only: in CI the step after the journeys uploads them (.github/workflows).
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
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
      // Ready once it takes connections, not once a page answers: next dev can start with one of its
      // pages answering 404 until a file of the page changes, /login too. The global setup opens the
      // pages the checks use and brings such a page back (global-setup.ts).
      port: DEV_PORT,
      env: e2eEnv(database, DEV),
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
