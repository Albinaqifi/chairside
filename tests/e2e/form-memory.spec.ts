import { expect, test, type Page } from '@playwright/test';
import { serveComponentsPage, type ComponentsPageServer } from './components-page-server.ts';
import { demoForm } from './demo-form.ts';

// D-093 in a real browser (E00-T06b; D-095): a staff form keeps nothing in the browser. On the demo
// form of /dev/components, a value is chosen in every field, then the page comes back after a
// reload as F5 makes it, from the page itself (`location.reload()`), or after Back from a page
// loaded as a new document. Every field must show its default, and both hidden
// inputs Radix keeps for the checkbox and the switch must be unchecked: one given back would send
// what the screen does not show. The document read must be the one the reload or the Back loaded,
// by its navigation type: a page that loads itself again would turn a Back into a reload.
//
// The page comes from a server of the test's own in front of `next dev` (components-page-server.ts),
// in an answer no browser shows again from its cache: after Back the page comes from the server and
// runs `next dev`'s script without the debug data `next dev` keeps in the browser, which a page from
// the cache waits for (the last test below). The browsers give fields back as from their cache.
//
// The control: the same server without the form's `autocomplete="off"`, the same steps get the
// values back, where the browser gives fields back at all. Measured with Playwright 1.63.0 on
// Windows (2026-10-08, and again on 2026-10-09 with the page from the server after Back): with the
// attribute, no browser gives a field back; without it, Firefox does after a reload and after Back,
// Chromium and WebKit after Back only. Where a browser gives nothing back, its control is skipped
// and says why.

type Return = 'reload' | 'back';

// Each test loads `next dev`'s page up to three times, through the test's own server: in a full run
// up to 25 s at 4 workers, against Playwright's 30 s (E00-T06b fix round 3, measured).
test.describe.configure({ timeout: 60_000 });

/**
 * How long the check waits for `next dev`'s page to come back and run its script. In a full run it
 * renders and hydrates while the run's other browsers load it too, and it has taken longer than
 * Playwright's 5 s without a fault (E00-T06b tester, after fix round 2: Firefox after Back; fix
 * round 3: 5.7 s for a first visit at 8 workers). What the check then reads keeps the 5 s.
 */
const DEV_PAGE = { timeout: 15_000 };

const GIVES_FIELDS_BACK: Record<string, Record<Return, boolean>> = {
  chromium: { reload: false, back: true },
  firefox: { reload: true, back: true },
  webkit: { reload: false, back: true },
};

const AFTER: Record<Return, string> = { reload: 'a reload (F5)', back: 'Back' };

/** The navigation type of a document the reload, or the Back, loaded (Navigation Timing). */
const LOADED_BY: Record<Return, NavigationTimingType> = { reload: 'reload', back: 'back_forward' };

/** Chooses a value in every field of the demo form, each its own action, and waits for each. */
async function chooseInEveryField(page: Page): Promise<void> {
  const form = demoForm(page);
  await expect(form.send).toBeEnabled(DEV_PAGE);
  await form.note.fill('A demo note');
  await form.code.fill('1234');
  await form.details.fill('Demo details');
  await form.choice.selectOption('second');
  // Radix's hidden input follows its control only after the click.
  await form.checkbox.click();
  await expect(form.hiddenCheckbox).toBeChecked();
  await form.switch.click();
  await expect(form.hiddenSwitch).toBeChecked();
  await form.answer('refusal').check();
}

/**
 * Leaves the page on `origin` and comes back, as a new document: the old one carries a mark that a
 * page kept in the browser's back/forward cache would still have. Its navigation type must be the
 * return's own: a page that loads itself again afterwards reads as a reload, even after Back.
 */
async function leaveAndComeBack(page: Page, how: Return, origin: string): Promise<void> {
  await page.evaluate(() => Object.assign(window, { d093OldDocument: true }));
  if (how === 'reload') {
    const loaded = page.waitForEvent('load');
    await page.evaluate(() => void setTimeout(() => location.reload(), 0));
    await loaded;
  } else {
    await page.goto(`${origin}/`);
    await page.goBack();
  }
  await expect(page).toHaveURL(`${origin}/dev/components`, DEV_PAGE);
  // The script has run: what React and Radix do with a restored value has happened.
  await expect(demoForm(page).send).toBeEnabled(DEV_PAGE);
  expect(
    await page.evaluate(() => 'd093OldDocument' in window),
    'the page came back as a new document, not from the back/forward cache',
  ).toBe(false);
  expect(
    await page.evaluate(
      () =>
        (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
          ?.type,
    ),
    `the document read is the one ${AFTER[how]} loaded, not a load after it`,
  ).toBe(LOADED_BY[how]);
}

/** Runs `steps` with the components page served for this test alone (components-page-server.ts). */
async function withComponentsPage(
  options: { stripFormAutocomplete: boolean },
  steps: (server: ComponentsPageServer) => Promise<void>,
): Promise<void> {
  const server = await serveComponentsPage(options);
  try {
    await steps(server);
  } finally {
    await server.close();
  }
}

for (const how of ['reload', 'back'] as const) {
  test(`after ${AFTER[how]}, every field of the demo form shows its default`, async ({ page }) => {
    await withComponentsPage({ stripFormAutocomplete: false }, async ({ origin }) => {
      await page.goto(`${origin}/dev/components`);
      await chooseInEveryField(page);
      await leaveAndComeBack(page, how, origin);

      const form = demoForm(page);
      await expect(form.form).toHaveAttribute('autocomplete', 'off');
      await expect(form.note).toHaveValue('');
      await expect(form.code).toHaveValue('');
      await expect(form.details).toHaveValue('');
      await expect(form.choice).toHaveValue('');
      await expect(form.checkbox).not.toBeChecked();
      await expect(form.switch).not.toBeChecked();
      await expect(form.answer('done')).toBeChecked();
      await expect(form.hiddenCheckbox).not.toBeChecked();
      await expect(form.hiddenSwitch).not.toBeChecked();
    });
  });

  test(`control: without the form's autocomplete="off", ${AFTER[how]} gives the values back`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      !GIVES_FIELDS_BACK[browserName]?.[how],
      `${browserName} gives no field back after ${AFTER[how]}, with the form's attribute or without (measured on Windows)`,
    );
    await withComponentsPage({ stripFormAutocomplete: true }, async ({ origin }) => {
      await page.goto(`${origin}/dev/components`);
      await expect(demoForm(page).form).not.toHaveAttribute('autocomplete');
      await chooseInEveryField(page);
      await leaveAndComeBack(page, how, origin);

      // What the form's attribute guards; the note and the code have their own.
      const form = demoForm(page);
      await expect(form.details).toHaveValue('Demo details');
      await expect(form.choice).toHaveValue('second');
      await expect(form.answer('refusal')).toBeChecked();
      // Given back while the controls show off: the form would send what the screen does not show.
      await expect(form.hiddenCheckbox).toBeChecked();
      await expect(form.hiddenSwitch).toBeChecked();
      await expect(form.checkbox).not.toBeChecked();
    });
  });
}

/**
 * The IndexedDB database where `next dev`'s script keeps each page's debug data, to show the page
 * again from the browser's cache (Next.js 16.3.8, `next/dist/client/dev/debug-channel.js`).
 */
const NEXT_DEV_DEBUG_DATA = '__next_debug_channel';

/**
 * Makes every request to open NEXT_DEV_DEBUG_DATA wait forever, as a stalled read would, and counts
 * them in the page (`window.debugDataRequests`): a test can then see that `next dev` asked.
 */
async function holdNextDevDebugData(page: Page): Promise<void> {
  await page.addInitScript((database) => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      if (name !== database) return open.call(this, name, version);
      const counted = window as Window & { debugDataRequests?: number };
      counted.debugDataRequests = (counted.debugDataRequests ?? 0) + 1;
      // A request that never answers: neither success nor error.
      return { addEventListener() {}, removeEventListener() {} } as unknown as IDBOpenDBRequest;
    };
  }, NEXT_DEV_DEBUG_DATA);
}

// After Back the check's page must run its script without the debug data `next dev` keeps in the
// browser: a page shown again from the browser's cache waits for it, and the pages that never ran
// their script after Back had come from the cache (E00-T06b testers, fix rounds 2 and 3, Firefox
// under load). Here that data never comes. With the page served as `next dev` serves it, red in
// Chromium and Firefox every time (fix round 4, measured); WebKit loaded it from the server either
// way.
test("after Back, the demo form's page runs its script without the debug data next dev keeps in the browser", async ({
  page,
}) => {
  await holdNextDevDebugData(page);
  await withComponentsPage({ stripFormAutocomplete: false }, async ({ origin }) => {
    await page.goto(`${origin}/dev/components`);
    await expect(demoForm(page).send).toBeEnabled(DEV_PAGE);
    // `next dev` stores the page's debug data once the page is idle: it asked, so the hold is in its way.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as Window & { debugDataRequests?: number }).debugDataRequests ?? 0,
          ),
        { message: "next dev asks for the database of a page's debug data", ...DEV_PAGE },
      )
      .toBeGreaterThan(0);
    await leaveAndComeBack(page, 'back', origin);
  });
});
