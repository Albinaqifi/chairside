import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED_PASSWORD, SEEDED_PEOPLE } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { expectNoAxeViolations } from './axe.ts';
import { APP, SIGNED_OUT } from './servers.ts';

// Journey J1 (test-strategy.md, E00-T06b) on the production build: log in, see Today, log out; a
// wrong password is refused. J1 logs in itself, so it starts with no session. Its two sign-ins in
// each browser count against the limit of ten a minute (global-setup.ts).

const { login, logout, nav } = messages;
const frontDesk = SEEDED_PEOPLE.frontDesk.email;

/**
 * Presses Tab until `target` has the focus, as a person at the keyboard would, and fails when it
 * never does. WebKit's Tab skips links (Safari's default), so the count is a bound, not the order.
 */
async function tabTo(page: Page, target: Locator, most = 25): Promise<void> {
  for (let presses = 0; presses < most; presses++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach the element within ${most} presses.`);
}

test.describe('J1', () => {
  test.use({ storageState: SIGNED_OUT });

  // The keyboard walk of D-086 is J1 itself: one J1 a browser, with the keyboard alone.
  test('the front desk logs in, sees Today and logs out, with the keyboard alone; a wrong password is refused', async ({
    page,
  }) => {
    const email = page.getByLabel(login.email, { exact: true });
    const password = page.getByLabel(login.password, { exact: true });

    await page.goto(`${APP}/login`);
    // The button is enabled once the form runs in the browser (D-076); the email field has the focus.
    await expect(page.getByRole('button', { name: login.submit })).toBeEnabled();
    await expect(email).toBeFocused();
    await page.keyboard.type(frontDesk);
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.type('not-the-password');
    await page.keyboard.press('Enter');

    // Refused, on the login page, with the same text whether the email exists or not. In the form:
    // Next.js's route announcer is an alert too.
    await expect(page.locator('form').getByRole('alert')).toHaveText(login.errors.wrongCredentials);
    await expect(page).toHaveURL(`${APP}/login`);
    await expectNoAxeViolations(page);

    // The right password, typed over the wrong one.
    await expect(password).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(SEED_PASSWORD);
    await page.keyboard.press('Enter');

    // Today: the seeded front desk is in one clinic, so no clinic picker comes first.
    await expect(page).toHaveURL(`${APP}/`);
    await expect(page.getByRole('heading', { level: 1, name: nav.today })).toBeVisible();

    // Log out: the sidebar's last item, reached with Tab.
    await tabTo(page, page.getByRole('button', { name: logout.button }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${APP}/login`);
    await expect(page.getByRole('heading', { level: 1, name: login.heading })).toBeVisible();

    // The session has ended: Today sends to the login page again.
    await page.goto(`${APP}/`);
    await expect(page).toHaveURL(`${APP}/login`);
  });
});

test.describe('J1 with JavaScript off', () => {
  test.use({ storageState: SIGNED_OUT, javaScriptEnabled: false });

  // E00-T09, D-076: the button stays disabled without the script, so neither Enter nor a click sends
  // the form, and the password never reaches the address bar or the browser's history.
  test('the login form sends nothing, and the password stays out of the address and the history', async ({
    page,
  }) => {
    const secret = 'typed-without-javascript';
    await page.goto(`${APP}/login`);
    const url = page.url();
    const historyLength = await page.evaluate(() => history.length);

    // Everything the page asks for from here on: a navigation, a call to the auth library, or
    // anything that carries the email or the password.
    const sent: string[] = [];
    page.on('request', (request) => {
      const carried = `${request.url()} ${request.postData() ?? ''}`;
      if (
        request.isNavigationRequest() ||
        request.url().includes('/api/auth/') ||
        carried.includes(secret) ||
        carried.includes(frontDesk) ||
        carried.includes(encodeURIComponent(frontDesk))
      ) {
        sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await page.getByLabel(login.email, { exact: true }).fill(frontDesk);
    await page.getByLabel(login.password, { exact: true }).fill(secret);
    await page.getByLabel(login.password, { exact: true }).press('Enter');
    const submit = page.getByRole('button', { name: login.submit });
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    // A form that is sent starts its request at once; a second is plenty to see one.
    await page.waitForTimeout(1_000);

    expect(sent, 'requests the login form sent').toEqual([]);
    expect(page.url()).toBe(url);
    expect(page.url()).not.toContain(secret);
    expect(await page.evaluate(() => history.length), 'entries in the history').toBe(historyLength);
  });
});
