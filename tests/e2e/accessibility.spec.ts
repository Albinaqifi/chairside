import { expect, test } from '@playwright/test';
import messages from '@/i18n/en.json' with { type: 'json' };
import { expectNoAxeViolations } from './axe.ts';
import { demoForm } from './demo-form.ts';
import { APP, DEV, SIGNED_OUT } from './servers.ts';

// The accessibility check (E00-T06b, D-100): WCAG 2.1 A and AA with axe-core, on the pages J1 visits
// (the production build) and on /dev/components (next dev), as the seeded front desk whose session
// the global setup made. J1 also checks the login page with its refusal showing (j1.spec.ts). Then
// the keyboard walk of the demo form (D-086).

test.describe('signed out', () => {
  test.use({ storageState: SIGNED_OUT });

  test('the login page has no WCAG 2.1 A or AA violation', async ({ page }) => {
    await page.goto(`${APP}/login`);
    await expect(page.getByRole('button', { name: messages.login.submit })).toBeEnabled();
    await expectNoAxeViolations(page);
  });
});

test('Today has no WCAG 2.1 A or AA violation', async ({ page }) => {
  await page.goto(`${APP}/`);
  await expect(page.getByRole('heading', { level: 1, name: messages.nav.today })).toBeVisible();
  await expectNoAxeViolations(page);
});

test('the components page has no WCAG 2.1 A or AA violation', async ({ page }) => {
  await page.goto(`${DEV}/dev/components`);
  await expect(demoForm(page).send).toBeEnabled();
  await expectNoAxeViolations(page);
});

test('on the demo form, Tab reaches every field and then the button, in order', async ({
  page,
}) => {
  await page.goto(`${DEV}/dev/components`);
  const form = demoForm(page);
  await expect(form.send).toBeEnabled();

  // From the first field on; the radio group is one stop, its chosen answer.
  await form.note.focus();
  for (const next of [
    form.code,
    form.details,
    form.choice,
    form.checkbox,
    form.switch,
    form.answer('done'),
    form.send,
  ]) {
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
  }
});
