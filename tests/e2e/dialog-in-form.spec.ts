import { expect, test, type Page } from '@playwright/test';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { DEV } from './servers.ts';

// E01-T06e: a dialog inside a form, and a form inside the dialog, on /dev/components (`next dev`; a
// production build answers 404 for it). React passes a `submit` on to every onSubmit above, through a
// portal too, and StaffForm sends from onSubmit: without the stop in the dialog's content
// (src/ui/dialog.tsx), pressing the inner form's button would send the outer form as well. The outer
// form's answer is a refusal and the inner one's is done, so the outer form's text showing, or a
// second request, means the stop is gone. As the front desk (the global setup's session).

const t = messages.devComponents.nested;

/** The requests that call a server action, from now on. */
function countActions(page: Page): { requests: () => number } {
  let count = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) count += 1;
  });
  return { requests: () => count };
}

test.describe('a dialog inside a form (acceptance 1)', () => {
  test("pressing the inner form's button sends the inner form only; the outer form, pressed itself, sends and is refused", async ({
    page,
  }) => {
    await page.goto(`${DEV}/dev/components`);
    const outer = page.getByRole('button', { name: t.outerSubmit, exact: true });
    // The script has run: the form's button is enabled only then.
    await expect(outer).toBeEnabled();
    await page.waitForLoadState('networkidle');
    const sent = countActions(page);

    await page.getByRole('button', { name: t.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: t.title });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
    await dialog.getByRole('button', { name: t.innerSubmit, exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Notifications (F8)', includeHidden: true })
        .getByText(t.innerDone),
      "the inner form's answer: done",
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(sent.requests(), 'one request: the inner form').toBe(1);
    await expect(
      page.getByText(t.outerRefused),
      "the outer form's refusal never shows",
    ).toHaveCount(0);

    // The control: the outer form, pressed itself, is sent and refused, so the check above could fail.
    // The first Escape is the toast's, a layer above the dialog; the second closes the dialog.
    await page.keyboard.press('Escape');
    await expect(
      page
        .getByRole('region', { name: 'Notifications (F8)', includeHidden: true })
        .getByRole('listitem'),
      'no toast up',
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await outer.click();
    await expect(page.getByText(t.outerRefused)).toBeVisible();
    expect(sent.requests(), 'two requests: the inner form, then the outer').toBe(2);
  });
});
