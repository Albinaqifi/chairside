import { expect, test, type Page } from '@playwright/test';
import messages from '@/i18n/en.json' with { type: 'json' };
import { expectNoAxeViolations } from './axe.ts';
import { demoForm } from './demo-form.ts';
import { APP, DEV, SIGNED_OUT } from './servers.ts';

// The accessibility check (E00-T06b, D-100): WCAG 2.1 A and AA with axe-core, on the pages J1 visits
// (the production build) and on /dev/components (next dev), as the seeded front desk whose session
// the global setup made. J1 also checks the login page with its refusal showing (j1.spec.ts). Then
// the same pages with their entry fade held, on a busy page too, and the keyboard walk of the demo
// form (D-086).

/** The entry animation's name in `globals.css`: the pages fade in with it, 0.3 s from opacity 0. */
const ENTRY_FADE = 'enter';

/** The class that gives a page that fade (`--animate-enter` in `globals.css`), under any variant. */
const ENTRY_FADE_UTILITY = 'animate-enter';

/**
 * Holds every entry fade of the page 60 ms in, as a busy run can find a page when axe reads it: the
 * fade starts once the page is drawn, and its heading counts as visible at opacity 0 (E00-T06b
 * tester: held there, axe found `color-contrast` on all three pages in every browser). A style the
 * document has before its first element: each fade starts held, so no task, however long, runs it
 * to its end first. Waiting for the fade's `animationstart` to hold it did not: on a busy page the
 * fade started and ended inside one task, and nothing was held (E00-T06b tester, after fix round 2).
 */
async function holdEntryFade(page: Page): Promise<void> {
  await page.addInitScript((utility) => {
    const held = new CSSStyleSheet();
    held.replaceSync(
      `[class*="${utility}"] { animation-play-state: paused !important; animation-delay: -60ms !important; }`,
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, held];
  }, ENTRY_FADE_UTILITY);
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

/** A task longer than the entry fade's 0.3 s. */
const BUSY_MS = 400;

/**
 * Two ways a page can be busy while its entry fade runs, each a task longer than the fade (E00-T06b
 * tester, after fix round 2, who made both happen): the fade then starts and ends inside the task.
 * A task right after the frame that first draws the fade, and a task at DOMContentLoaded once the
 * page is laid out, as hydration lays it out. A hold that waited for the fade to start held nothing
 * then: the first way in Chromium and Firefox, the second in WebKit (measured 2026-10-09).
 */
const BUSY_PAGES: Record<string, (page: Page) => Promise<void>> = {
  'right after the frame that first draws its fade': async (page) => {
    await page.addInitScript(
      ({ fade, ms }) => {
        const untilDrawn = () => {
          const drawn = document
            .getAnimations()
            .some(
              (animation) => animation instanceof CSSAnimation && animation.animationName === fade,
            );
          if (!drawn) {
            requestAnimationFrame(untilDrawn);
            return;
          }
          setTimeout(() => {
            const end = performance.now() + ms;
            while (performance.now() < end) {
              // Busy.
            }
          }, 0);
        };
        requestAnimationFrame(untilDrawn);
      },
      { fade: ENTRY_FADE, ms: BUSY_MS },
    );
  },
  'at DOMContentLoaded, laid out first': async (page) => {
    await page.addInitScript((ms) => {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          document.body.getBoundingClientRect();
          const end = performance.now() + ms;
          while (performance.now() < end) {
            // Busy.
          }
        },
        { once: true },
      );
    }, BUSY_MS);
  },
};

// The same three pages, read while their entry fade is held: the check gives the answer of the page
// at rest however late the fade ends (E00-T06b tester: red in 2 of 13 runs, axe reading Today's
// muted line mid-fade). Then again with the page busy as its fade runs: the fade is held all the same.
test.describe('with the entry fade held', () => {
  test.beforeEach(async ({ page }) => {
    await holdEntryFade(page);
  });

  heldFadeTests();

  for (const [busy, makeBusy] of Object.entries(BUSY_PAGES)) {
    test.describe(`the page busy ${busy}`, () => {
      test.beforeEach(async ({ page }) => {
        await makeBusy(page);
      });

      heldFadeTests();
    });
  }
});

/** The three pages' checks with their fade held: the hold comes from the describe that calls this. */
function heldFadeTests(): void {
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
}

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
