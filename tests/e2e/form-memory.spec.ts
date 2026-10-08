import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { demoForm } from './demo-form.ts';
import { DEV } from './servers.ts';

// D-093 in a real browser (E00-T06b; D-095): a staff form keeps nothing in the browser. On the demo
// form of /dev/components, a value is chosen in every field, then the page comes back after a
// reload as F5 makes it, from the page itself (`location.reload()`), or after Back from a page
// loaded as a new document. Every field must show its default, and both hidden
// inputs Radix keeps for the checkbox and the switch must be unchecked: one given back would send
// what the screen does not show.
//
// The control: served without the form's `autocomplete="off"`, the same steps get the values back,
// where the browser gives fields back at all. Measured with Playwright 1.63.0 (2026-10-08): Firefox
// after a reload and after Back, Chromium after Back only, WebKit never, with or without the
// attribute. Where a browser gives nothing back, its control is skipped and says why.

type Return = 'reload' | 'back';

const GIVES_FIELDS_BACK: Record<string, Record<Return, boolean>> = {
  chromium: { reload: false, back: true },
  firefox: { reload: true, back: true },
  webkit: { reload: false, back: false },
};

const AFTER: Record<Return, string> = { reload: 'a reload (F5)', back: 'Back' };

/** Chooses a value in every field of the demo form, each its own action, and waits for each. */
async function chooseInEveryField(page: Page): Promise<void> {
  const form = demoForm(page);
  await expect(form.send).toBeEnabled();
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
 * Leaves the page and comes back, as a new document: the old one carries a mark that a page kept in
 * the browser's back/forward cache would still have.
 */
async function leaveAndComeBack(page: Page, how: Return): Promise<void> {
  await page.evaluate(() => Object.assign(window, { d093OldDocument: true }));
  if (how === 'reload') {
    const loaded = page.waitForEvent('load');
    await page.evaluate(() => void setTimeout(() => location.reload(), 0));
    await loaded;
  } else {
    await page.goto(`${DEV}/`);
    await page.goBack();
  }
  await expect(page).toHaveURL(`${DEV}/dev/components`);
  // The script has run: what React and Radix do with a restored value has happened.
  await expect(demoForm(page).send).toBeEnabled();
  expect(
    await page.evaluate(() => 'd093OldDocument' in window),
    'the page came back as a new document, not from the back/forward cache',
  ).toBe(false);
}

/**
 * Serves /dev/components with the form's own `autocomplete="off"` taken out of the HTML, for the
 * control. The fields' own `autocomplete="off"` (the note and the code) stay.
 */
async function serveWithoutFormAutocomplete(context: BrowserContext): Promise<void> {
  await context.route(`${DEV}/dev/components`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    const body = html.replace(/<form\b[^>]*>/gi, (tag) => tag.replace(/\sautocomplete="off"/i, ''));
    // The server's headers, but for those about the body it sent, which is no longer that body.
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(
        ([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name),
      ),
    );
    await route.fulfill({ status: response.status(), headers, body });
  });
}

for (const how of ['reload', 'back'] as const) {
  test(`after ${AFTER[how]}, every field of the demo form shows its default`, async ({ page }) => {
    await page.goto(`${DEV}/dev/components`);
    await chooseInEveryField(page);
    await leaveAndComeBack(page, how);

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

  test(`control: without the form's autocomplete="off", ${AFTER[how]} gives the values back`, async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      !GIVES_FIELDS_BACK[browserName]?.[how],
      `${browserName} gives no field back after ${AFTER[how]}, with the attribute or without`,
    );
    await serveWithoutFormAutocomplete(context);
    await page.goto(`${DEV}/dev/components`);
    await expect(demoForm(page).form).not.toHaveAttribute('autocomplete');
    await chooseInEveryField(page);
    await leaveAndComeBack(page, how);

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
}
