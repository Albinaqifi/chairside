import { request } from '@playwright/test';
import { closeDb } from '@/db/client';
import { resetDatabase } from '@/db/reset';
import { seedDatabase } from '@/db/seed';
import { SEED_PASSWORD, SEEDED_PEOPLE } from '@/db/seed/seeded';
import { e2eDatabase } from './e2e-database.ts';
import { APP, DEV, e2eEnv, FRONT_DESK_SESSION } from './servers.ts';

/**
 * Once per run, after Playwright has started both servers (playwright.config.ts) and before any
 * test:
 * 1. Rebuilds the run's database (`<database>_e2e`) from the migrations and fills it with the seed,
 *    as the integration tests rebuild theirs. resetDatabase() and seedDatabase() refuse every
 *    database that is not on this machine. Never the development database.
 * 2. Logs the seeded front desk in once, through the auth library's own route, and keeps the
 *    session for the accessibility and D-093 checks in every browser, on both servers. J1 logs in
 *    itself. A run signs in at most seven times: this once, and J1's two in each of three browsers;
 *    the limit is ten a minute (D-064 point 5), counted in the run's fresh database.
 * 3. Opens /dev/components and Today on `next dev` with that session, so it compiles them before
 *    the tests ask.
 */
export default async function globalSetup(): Promise<void> {
  const database = e2eDatabase();
  // The seed makes people through DATABASE_URL (checkSeedTargets), with the auth library's
  // settings: name the run's database before anything connects.
  Object.assign(process.env, e2eEnv(database, APP));
  await resetDatabase(database);
  try {
    await seedDatabase(database);
  } finally {
    await closeDb();
  }

  const browserless = await request.newContext({ baseURL: APP });
  try {
    const signIn = await browserless.post('/api/auth/sign-in/email', {
      headers: { origin: APP },
      data: { email: SEEDED_PEOPLE.frontDesk.email, password: SEED_PASSWORD },
    });
    if (!signIn.ok()) {
      throw new Error(`The seeded front desk could not sign in (status ${signIn.status()}).`);
    }
    // The first request of a page makes `next dev` compile it, which can take a while on CI: the
    // components page, and Today, which the D-093 check leaves it for.
    for (const pathname of ['/dev/components', '/']) {
      const page = await browserless.get(`${DEV}${pathname}`, {
        maxRedirects: 0,
        timeout: 180_000,
      });
      if (page.status() !== 200) {
        throw new Error(`${pathname} on next dev answered ${page.status()}, not 200.`);
      }
    }
    await browserless.storageState({ path: FRONT_DESK_SESSION });
  } finally {
    await browserless.dispose();
  }
}
