import { randomBytes } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClinicWithOwner } from '@/db/clinic-create';
import { closeDb } from '@/db/client';
import messages from '@/i18n/en.json' with { type: 'json' };
import { newId } from '@/lib/ids';
import { expectNoAxeViolations } from './axe.ts';
import { e2eDatabase } from './e2e-database.ts';
import { APP, e2eEnv, SIGNED_OUT } from './servers.ts';

// E00-T05b, acceptance 9: the page a setup link opens (/login/set-password), on the production build,
// in each browser. Each test makes its own clinic and owner with `pnpm clinic:create`'s own function,
// on the run's database, as the app role: the link it gives is the one the operator would send. No
// test signs in (the run's sign-ins stay at seven, D-100): the integration tests prove the owner
// signs in with the password chosen (tests/integration/clinic-create.test.ts).

const texts = messages.setPassword;
const NEW_PASSWORD = 'e2e-chosen-password';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The one text of a link that does not work, as the page shows it: links work for 3 days. */
const INVALID_LINK = texts.errors.invalidLink.replace('{days}', '3');

test.use({ storageState: SIGNED_OUT });

// The four links' test loads the page five times: in a full run on Windows, 13.5 s in WebKit (5.7 s
// in Chromium), against Playwright's 30 s, on a machine faster than CI's (measured 2026-10-09).
test.describe.configure({ timeout: 60_000 });

test.beforeAll(() => {
  // The script's function reaches the run's database and makes links to this run's app, as the
  // servers and the global setup do.
  Object.assign(process.env, e2eEnv(e2eDatabase(), APP));
});

test.afterAll(async () => {
  await closeDb();
});

/** A new clinic and its owner, made now or at `now`: the owner's setup link. */
async function setupLink(now = new Date()): Promise<string> {
  const result = await createClinicWithOwner(
    {
      name: 'Lakeside Dental',
      ownerEmail: `e2e-owner-${newId().slice(-12)}@example.test`,
      ownerName: 'Owner',
      timeZone: 'Europe/Skopje',
      country: 'MK',
      currency: 'MKD',
      locale: 'en',
    },
    now,
  );
  if (!result.ok) throw new Error(`clinic:create refused: ${result.refusal}`);
  return result.link;
}

/**
 * Presses Tab until `target` has the focus, as a person at the keyboard would, and fails when it
 * never does (as J1's tabTo: WebKit's Tab skips links, so the count is a bound, not the order).
 */
async function tabTo(page: Page, target: Locator, most = 10): Promise<void> {
  for (let presses = 0; presses < most; presses++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the element within ${most} presses.`);
}

/** Opens the link as a new document, the page's form ready once its script runs. */
async function open(page: Page, link: string): Promise<void> {
  // Another link to the same page differs only after `#`: from there, the browser would not load it.
  await page.goto('about:blank');
  await page.goto(link);
  await expect(page.getByRole('button', { name: texts.submit })).toBeEnabled();
}

/** Types a new password with the keyboard alone, and sends it with Enter. */
async function choosePassword(page: Page): Promise<void> {
  await tabTo(page, page.getByLabel(texts.password, { exact: true }));
  await page.keyboard.type(NEW_PASSWORD);
  await page.keyboard.press('Enter');
}

test('a link the script made opens the page; a password chosen with the keyboard alone is set, and the page says so', async ({
  page,
}) => {
  const link = await setupLink();
  // Every request the page makes: the token may travel in the body of the one that sets the
  // password, never in an address or a Referer, which request logs keep (D-101).
  const token = new URL(link).hash.slice(1);
  const requests: { where: string; referer: string; body: string }[] = [];
  page.on('request', (request) =>
    requests.push({
      where: request.url(),
      referer: request.headers()['referer'] ?? '',
      body: request.postData() ?? '',
    }),
  );

  await open(page, link);
  await expect(page.getByRole('heading', { level: 1, name: texts.heading })).toBeVisible();
  await expectNoAxeViolations(page);

  await choosePassword(page);

  const done = page.getByRole('status').filter({ hasText: texts.done });
  await expect(done).toBeVisible();
  await expect(done, 'the line that says so takes the focus').toBeFocused();
  await expectNoAxeViolations(page);

  // The way on: the login page. A click, as WebKit's Tab skips links (Safari's default).
  await page.getByRole('link', { name: texts.logIn }).click();
  await expect(page).toHaveURL(`${APP}/login`);

  const carried = requests.filter(({ body }) => body.includes(token));
  expect(carried.map(({ where }) => new URL(where).pathname)).toEqual(['/api/auth/reset-password']);
  for (const { where, referer } of requests) {
    // What goes over the wire: Playwright may report a navigation with its fragment, which the
    // browser keeps to itself.
    const address = new URL(where);
    address.hash = '';
    expect(`${address.href} ${referer}`, 'an address or a Referer').not.toContain(token);
  }
});

test('a used, an expired, a wrong and a missing token: one and the same message, and nothing set', async ({
  page,
}) => {
  const used = await setupLink();
  await open(page, used);
  await choosePassword(page);
  await expect(page.getByRole('status').filter({ hasText: texts.done })).toBeVisible();

  const links = {
    used,
    expired: await setupLink(new Date(Date.now() - 4 * DAY_MS)),
    wrong: `${APP}/login/set-password#${randomBytes(32).toString('base64url')}`,
    missing: `${APP}/login/set-password`,
  };
  for (const [kind, link] of Object.entries(links)) {
    await open(page, link);
    await choosePassword(page);
    // In the form: Next.js's route announcer is an alert too.
    await expect(page.locator('form').getByRole('alert'), kind).toHaveText(INVALID_LINK);
    await expect(page.getByRole('status').filter({ hasText: texts.done }), kind).toHaveCount(0);
  }
  await expectNoAxeViolations(page);
});

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  // As the login form (D-076): the button stays disabled without the script, so neither Enter nor a
  // click sends the form, and the password never reaches the address bar or the browser's history.
  test('the form sends nothing, and the password stays out of the address and the history', async ({
    page,
  }) => {
    const link = await setupLink();
    await page.goto(link);
    const url = page.url();
    const historyLength = await page.evaluate(() => history.length);

    // Everything the page asks for from here on: a navigation, a call to the auth library, or
    // anything that carries the password or the token.
    const token = new URL(link).hash.slice(1);
    const sent: string[] = [];
    page.on('request', (request) => {
      const carried = `${request.url()} ${request.postData() ?? ''}`;
      if (
        request.isNavigationRequest() ||
        request.url().includes('/api/auth/') ||
        carried.includes(NEW_PASSWORD) ||
        carried.includes(token)
      ) {
        sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    const password = page.getByLabel(texts.password, { exact: true });
    await password.fill(NEW_PASSWORD);
    await password.press('Enter');
    const submit = page.getByRole('button', { name: texts.submit });
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    // A form that is sent starts its request at once; a second is plenty to see one.
    await page.waitForTimeout(1_000);

    expect(sent, 'requests the form sent').toEqual([]);
    expect(page.url()).toBe(url);
    expect(page.url()).not.toContain(NEW_PASSWORD);
    expect(await page.evaluate(() => history.length), 'entries in the history').toBe(historyLength);
  });
});
