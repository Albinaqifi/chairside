import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 A and AA, as axe-core tags its rules (E00-T06b; axe-core is the owner's choice, D-100). */
const WCAG_21_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Takes every animation on the page that has an end to that end, so the page stands as a person
 * reads it once it has settled. The pages fade in from opacity 0 (`motion-safe:animate-enter`,
 * 0.3 s, globals.css) and Playwright counts an element as visible at opacity 0, so axe could read a
 * page mid-fade and measure its faded text: red now and then without a fault (E00-T06b tester). An
 * animation without an end (one repeated forever) cannot be finished and runs on.
 */
async function endAnimations(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const end = animation.effect?.getComputedTiming().endTime;
      if (animation.playbackRate !== 0 && typeof end === 'number' && Number.isFinite(end)) {
        animation.finish();
      }
    }
  });
}

/**
 * Fails when axe-core finds a WCAG 2.1 A or AA violation on the page once its animations have
 * ended, naming each rule and the element it found, by its selector. Next.js's dev tools element
 * (`nextjs-portal`, on `next dev` only) is not ours and is left out; any other element is left out
 * only by name, in `leftOut`, with a Discovered line, never a rule.
 */
export async function expectNoAxeViolations(page: Page, leftOut: string[] = []): Promise<void> {
  await endAnimations(page);
  let axe = new AxeBuilder({ page }).withTags(WCAG_21_A_AA).exclude('nextjs-portal');
  for (const selector of leftOut) axe = axe.exclude(selector);
  const { violations } = await axe.analyze();
  const found = violations.flatMap((rule) =>
    rule.nodes.map((node) => `${rule.id} (${rule.help}): ${node.target.join(' ')}`),
  );
  expect(found, `WCAG 2.1 A and AA violations on ${new URL(page.url()).pathname}`).toEqual([]);
}
