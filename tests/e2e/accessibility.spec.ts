import { expect, test, type Page } from '@playwright/test';
import messages from '@/i18n/en.json' with { type: 'json' };
import { expectNoAxeViolations } from './axe.ts';
import { demoForm } from './demo-form.ts';
import { APP, DEV, SIGNED_OUT } from './servers.ts';

// The accessibility check (E00-T06b, D-100): WCAG 2.1 A and AA with axe-core, on the pages J1 visits
// (the production build) and on /dev/components (next dev), as the seeded front desk whose session
// the global setup made. J1 also checks the login page with its refusal showing (j1.spec.ts). Then
// the same pages with their entry fade held, and the keyboard walk of the demo form (D-086).

/** The entry animation's name in `globals.css`: the pages fade in with it, 0.3 s from opacity 0. */
const ENTRY_FADE = 'enter';

/**
 * Holds every entry fade of the page 60 ms in, from the frame it starts on, as a busy run can find
 * a page when axe reads it: the fade starts once the page is drawn, and its heading counts as
 * visible at opacity 0 (E00-T06b tester: held there, axe found `color-contrast` on all three pages
 * in every browser). Set before the page loads, so it is never too late.
 */
async function holdEntryFade(page: Page): Promise<void> {
  await page.addInitScript((fade) => {
    document.addEventListener(
      'animationstart',
      (event) => {
        if (event.animationName !== fade || !(event.target instanceof Element)) return;
        for (const animation of event.target.getAnimations()) {
          if (!(animation instanceof CSSAnimation) || animation.animationName !== fade) continue;
          animation.pause();
          animation.currentTime = 60;
        }
      },
      true,
    );
  }, ENTRY_FADE);
}

/** Waits until the page's entry fade is held: a check run with none held would prove nothing. */
async function expectEntryFadeHeld(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (fade) =>
            document
              .getAnimations()
              .some(
                (animation) =>
                  animation instanceof CSSAnimation &&
                  animation.animationName === fade &&
                  animation.playState === 'paused',
              ),
          ENTRY_FADE,
        ),
      { message: 'the entry fade is held' },
    )
    .toBe(true);
}

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

// The same three pages, read while their entry fade is held: the check gives the answer of the page
// at rest however late the fade ends (E00-T06b tester: red in 2 of 13 runs, axe reading Today's
// muted line mid-fade).
test.describe('with the entry fade held', () => {
  test.beforeEach(async ({ page }) => {
    await holdEntryFade(page);
  });

  test.describe('signed out', () => {
    test.use({ storageState: SIGNED_OUT });

    test('the login page has no WCAG 2.1 A or AA violation once its fade has ended', async ({
      page,
    }) => {
      await page.goto(`${APP}/login`);
      await expect(page.getByRole('button', { name: messages.login.submit })).toBeEnabled();
      await expectEntryFadeHeld(page);
      await expectNoAxeViolations(page);
    });
  });

  test('Today has no WCAG 2.1 A or AA violation once its fade has ended', async ({ page }) => {
    await page.goto(`${APP}/`);
    await expect(page.getByRole('heading', { level: 1, name: messages.nav.today })).toBeVisible();
    await expectEntryFadeHeld(page);
    await expectNoAxeViolations(page);
  });

  test('the components page has no WCAG 2.1 A or AA violation once its fade has ended', async ({
    page,
  }) => {
    await page.goto(`${DEV}/dev/components`);
    await expect(demoForm(page).send).toBeEnabled();
    await expectEntryFadeHeld(page);
    await expectNoAxeViolations(page);
  });
});

test('on the demo form, Tab reaches every field and then the button, in order', async ({
  page,
}) => {
  await page.goto(`${DEV}/dev/components`);
  const form = demoForm(page);
  await expect(form.send).toBeEnabled();

  // Tab reaches the first field from the stop before the form (tester: focused by script alone, a
  // first field out of the Tab order passed); then every field, the radio group one stop, its
  // chosen answer.
  await form.note.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(form.note).not.toBeFocused();
  await page.keyboard.press('Tab');
  await expect(form.note).toBeFocused();
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
