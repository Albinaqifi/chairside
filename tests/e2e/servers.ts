import './load-env.ts';
import path from 'node:path';
import type { E2eDatabase } from './e2e-database.ts';

/*
 * The two servers of an end-to-end run (E00-T06b, D-100), both on the run's own database
 * (e2e-database.ts), each on a port of its own:
 * - APP, the production build in `.next` (`pnpm build` first), started with `next start`: J1 and
 *   the checks of the pages J1 visits.
 * - DEV, `next dev`, for /dev/components, which a production build hides (E00-T04c). Next.js 16
 *   writes its output to `.next/dev`, beside the build, so both run at once.
 * Both are `localhost`, never 127.0.0.1: the auth library trusts only the origin BETTER_AUTH_URL
 * names, and the session cookie, set for `localhost`, reaches both ports.
 * The ports are 3100 and 3101 unless .env names others: a second checkout of this repository on
 * the same machine sets E2E_APP_PORT and E2E_DEV_PORT (README.md, "Two checkouts on one machine"),
 * so two runs never fight over one port.
 */

export const APP_PORT = port('E2E_APP_PORT', 3100);
export const DEV_PORT = port('E2E_DEV_PORT', 3101);
export const APP = `http://localhost:${APP_PORT}`;
export const DEV = `http://localhost:${DEV_PORT}`;

/** The port a variable names, or the default when it is unset or empty. */
function port(variable: string, fallback: number): number {
  const value = process.env[variable];
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${variable} must be a port number`);
  }
  return number;
}

/**
 * Signs the session cookies of both servers, which must share it for one session to work on both.
 * Fixed, as the integration tests' (vitest.config.ts), so a run does not depend on anyone's .env;
 * it signs sessions of the e2e database only.
 */
const E2E_AUTH_SECRET = 'e2e-only-secret-4b9d2f7a1c6e8b3d5f0a2c4e6b8d1f3a';

/**
 * What a server of the run, or the global setup's seed, is given on top of `.env`: a value already
 * in the process wins over `.env` in `next start`, `next dev` and the seed alike. The run's
 * database for both roles, and this server's own origin.
 */
export function e2eEnv(database: E2eDatabase, origin: string): Record<string, string> {
  return {
    DATABASE_URL: database.appUrl,
    MIGRATION_DATABASE_URL: database.migratorUrl,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

/**
 * The seeded front desk's session (Playwright's storageState), made once per run by the global
 * setup and reused by every browser on both servers. In an ignored folder (`.gitignore`).
 */
export const FRONT_DESK_SESSION = path.join(import.meta.dirname, '.auth', 'front-desk.json');

/** No session at all: for the journeys that log in themselves, and pages seen signed out. */
export const SIGNED_OUT = { cookies: [], origins: [] };
