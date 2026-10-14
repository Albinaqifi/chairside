import { utimesSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { request, type APIRequestContext } from '@playwright/test';
import { closeDb } from '@/db/client';
import { resetDatabase } from '@/db/reset';
import { seedDatabase } from '@/db/seed';
import { SEED_PASSWORD, SEEDED_PEOPLE } from '@/db/seed/seeded';
import { e2eDatabase } from './e2e-database.ts';
import { APP, DEV, e2eEnv, FRONT_DESK_SESSION, OWNER_SESSION } from './servers.ts';

/**
 * The pages the checks open on `next dev`, each with the file it is made from: the components
 * page, and Today, which the D-093 check leaves it for.
 */
const DEV_PAGES = [
  { pathname: '/dev/components', file: 'src/app/(staff)/dev/components/page.tsx' },
  { pathname: '/', file: 'src/app/(staff)/page.tsx' },
];

/**
 * Next.js 16.3.8's dev server now and then starts with one of its pages answering 404, its not-found
 * page, though it compiles the page and its manifests list it, and keeps answering 404 until a file
 * of the page changes (E00-T06b tester, after fix round 3: 2 of 277 starts). Measured on Windows in
 * fix round 4: 4 such starts, each the components page; the two given a new time on the page's file
 * answered 200 within 2 s. A page that answers 404 gets that new time, never new content, at most
 * this many times before the run stops.
 */
const TOUCHES = 3;

/**
 * Once per run, after Playwright has started both servers (playwright.config.ts) and before any
 * test:
 * 1. Rebuilds the run's database (`<database>_e2e`) from the migrations and fills it with the seed,
 *    as the integration tests rebuild theirs. resetDatabase() and seedDatabase() refuse every
 *    database that is not on this machine. Never the development database.
 * 2. Logs the seeded front desk in once, through the auth library's own route, and keeps the
 *    session for the accessibility and D-093 checks in every browser, on both servers; then the
 *    seeded owner, once, for the closed days' check (E01-T08c). J1 logs in itself. A run signs in at
 *    most eight times: these two, and J1's two in each of three browsers; the limit is ten a minute
 *    (D-064 point 5), counted in the run's fresh database.
 * 3. Opens /dev/components and Today on `next dev` with that session, so it compiles them before
 *    the tests ask, and brings back a page it answers 404 for (TOUCHES).
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
    for (const { pathname, file } of DEV_PAGES) await openOnDev(browserless, pathname, file);
    await browserless.storageState({ path: FRONT_DESK_SESSION });
  } finally {
    await browserless.dispose();
  }

  // A context of its own: a second sign-in in the front desk's would replace that session's cookie.
  const owner = await request.newContext({ baseURL: APP });
  try {
    const signIn = await owner.post('/api/auth/sign-in/email', {
      headers: { origin: APP },
      data: { email: SEEDED_PEOPLE.owner.email, password: SEED_PASSWORD },
    });
    if (!signIn.ok()) {
      throw new Error(`The seeded owner could not sign in (status ${signIn.status()}).`);
    }
    await owner.storageState({ path: OWNER_SESSION });
  } finally {
    await owner.dispose();
  }
}

/**
 * Opens one of next dev's pages with the session of `context`. Its first request makes next dev
 * compile it, which can take a while on CI. A 404 for one of these pages, which all exist, is the
 * start TOUCHES describes: the page's file gets a new time, which next dev sees as a change, and the
 * setup asks again.
 */
async function openOnDev(
  context: APIRequestContext,
  pathname: string,
  file: string,
): Promise<void> {
  for (let touches = 0; ; touches++) {
    const page = await context.get(`${DEV}${pathname}`, { maxRedirects: 0, timeout: 180_000 });
    if (page.status() === 200) return;
    if (page.status() !== 404 || touches === TOUCHES) {
      throw new Error(`${pathname} on next dev answered ${page.status()}, not 200.`);
    }
    const now = new Date();
    utimesSync(path.join(import.meta.dirname, '..', '..', file), now, now);
    console.warn(
      `${pathname} on next dev answered 404: ${file} given a new time (not new content), asking again.`,
    );
    await delay(2_000);
  }
}
