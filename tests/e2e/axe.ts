import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.1 A and AA, as axe-core tags its rules (E00-T06b; axe-core is the owner's choice, D-100). */
const WCAG_21_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Fails when axe-core finds a WCAG 2.1 A or AA violation on the page as it stands, naming each
 * rule and the element it found, by its selector. Next.js's dev tools element (`nextjs-portal`, on
 * `next dev` only) is not ours and is left out; any other element is left out only by name, in
 * `leftOut`, with a Discovered line, never a rule.
 */
export async function expectNoAxeViolations(page: Page, leftOut: string[] = []): Promise<void> {
  let axe = new AxeBuilder({ page }).withTags(WCAG_21_A_AA).exclude('nextjs-portal');
  for (const selector of leftOut) axe = axe.exclude(selector);
  const { violations } = await axe.analyze();
  const found = violations.flatMap((rule) =>
    rule.nodes.map((node) => `${rule.id} (${rule.help}): ${node.target.join(' ')}`),
  );
  expect(found, `WCAG 2.1 A and AA violations on ${new URL(page.url()).pathname}`).toEqual([]);
}
