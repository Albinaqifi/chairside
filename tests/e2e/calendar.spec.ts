import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T04b in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): the provider filter's chips, the day read again when the page is
// used and never on a timer (D-108), an ended session sent to the login page on the next use, and the
// "now" line by the browser's clock, which Playwright sets and moves (no real minute is waited). The
// days are far ahead of the seed's week, so nothing but this file's own rows is on them; the one
// check that writes adds its own appointment, on a day of its browser's own, and removes it.

/** The clinic's zone (the seed's, D-049): 2031 has no clock change in March or October around these. */
const SKOPJE_OFFSET = '+01:00';

/** A Monday far ahead, open 08:00–18:00 like every weekday of the seeded clinic. */
const MONDAY = '2031-03-03';

/** The day each browser writes its appointment on, so the three runs never share a row. */
const WRITE_DAY: Record<string, string> = {
  chromium: '2031-03-04',
  firefox: '2031-03-05',
  webkit: '2031-03-06',
};

/** A moment on the clinic's clock: `2031-03-03` at `10:00` in Skopje. */
const skopje = (day: string, time: string) => new Date(`${day}T${time}:00${SKOPJE_OFFSET}`);

const t = messages.calendar;

/** The provider filter's chips. */
const chips = (page: Page) =>
  page.getByRole('group', { name: t.providerFilter }).getByRole('button');

/** Previous, Today and Next: the sidebar has a Today of its own. */
const dayLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: t.dayNavigation }).getByRole('link', { name, exact: true });

/** The headers of the columns shown, by the id each name carries. */
const columns = (page: Page) => page.locator('[id^="calendar-column-"]');

/**
 * Waits until React has hydrated this element (it holds React's props), and the page has settled:
 * a chip clicked before would do nothing, and the prefetches of Previous, Today and Next are done.
 */
async function hydrated(page: Page, element: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        element.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the calendar' },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

/** Every request the page sends to the app, from now on, and each read of the day among them. */
function countRequests(page: Page): { all: string[]; reads: () => number } {
  const all: string[] = [];
  const reads: boolean[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(APP)) return;
    all.push(`${request.method()} ${new URL(request.url()).pathname}`);
    // A server action: a POST with Next.js's action header. The calendar's only one is its read.
    reads.push(request.method() === 'POST' && request.headers()['next-action'] !== undefined);
  });
  return { all, reads: () => reads.filter(Boolean).length };
}

/** Uses the page as a person would: the pointer moved over the title, and a key. */
async function usePage(page: Page): Promise<void> {
  const title = page.getByRole('heading', { level: 1 });
  const box = await title.boundingBox();
  if (!box) throw new Error('The title has no box to move the pointer over.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
  await page.keyboard.press('Shift');
}

test.describe('the provider filter (acceptance 1)', () => {
  test('the chips hide and show their columns, the last one on stays on, the choice holds over Previous, Next and Today', async ({
    page,
  }) => {
    await page.goto(`${APP}/calendar?day=${MONDAY}`);
    const [first, second, third] = [chips(page).nth(0), chips(page).nth(1), chips(page).nth(2)];
    await expect(chips(page)).toHaveCount(3);
    await hydrated(page, first);
    // The front desk is linked to no provider: every column, every chip pressed.
    for (const chip of [first, second, third])
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(columns(page)).toHaveCount(3);
    await expect(page.getByText('0 appointments · 3 chairs')).toBeVisible();

    await second.click();
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await expect(columns(page)).toHaveCount(2);
    await expect(page.getByText('0 appointments · 2 chairs')).toBeVisible();

    await first.click();
    await expect(columns(page)).toHaveCount(1);
    await expect(page.getByText('0 appointments · 1 chair', { exact: true })).toBeVisible();

    // The last one on stays on.
    await third.click();
    await expect(third).toHaveAttribute('aria-pressed', 'true');
    await expect(columns(page)).toHaveCount(1);

    const choiceHolds = async () => {
      await expect(first).toHaveAttribute('aria-pressed', 'false');
      await expect(second).toHaveAttribute('aria-pressed', 'false');
      await expect(third).toHaveAttribute('aria-pressed', 'true');
      await expect(columns(page)).toHaveCount(1);
    };
    await dayLink(page, t.nextDay).click();
    await expect(page).toHaveURL(`${APP}/calendar?day=2031-03-04`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tuesday, March 4, 2031');
    await choiceHolds();
    await dayLink(page, t.previousDay).click();
    await expect(page).toHaveURL(`${APP}/calendar?day=${MONDAY}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Monday, March 3, 2031');
    await choiceHolds();
    await dayLink(page, t.today).click();
    await expect(page).toHaveURL(`${APP}/calendar`);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Monday, March 3, 2031');
    await choiceHolds();

    // A reload starts again: the choice is the page's, not the browser's.
    await page.reload();
    await expect(columns(page)).toHaveCount(3);
    // Settled, so the test ends with no prefetch of the reloaded page cut off.
    await page.waitForLoadState('networkidle');
  });
});

test.describe('a fresh day when the page is used (acceptance 3)', () => {
  let db: pg.Pool;
  test.beforeAll(() => {
    db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
  });
  test.afterAll(async () => {
    await db.end();
  });

  test('a change shows on the next use 30 seconds after the last read, not on a use before; a page left alone sends nothing', async ({
    page,
  }, testInfo: TestInfo) => {
    const day = WRITE_DAY[testInfo.project.name];
    if (!day) throw new Error(`No day for the browser ${testInfo.project.name}.`);
    const { rows } = await db.query<{ id: string }>(
      `select id from patients where clinic_id = $1 order by id limit 1`,
      [SEEDED_CLINICS.harbourStreet],
    );
    const patientId = rows[0]?.id;
    if (!patientId) throw new Error('The seeded clinic has no patient.');
    const {
      rows: [added],
    } = await db.query<{ id: string }>(
      `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                                 status, source, created_by)
       values (gen_random_uuid(), $1, $2, $3, 'Checkup', $4, $5, 'booked', 'staff', $6)
       returning id`,
      [
        SEEDED_CLINICS.harbourStreet,
        patientId,
        SEEDED_PROVIDERS.harbourStreetDentist,
        skopje(day, '09:00'),
        skopje(day, '09:30'),
        SEEDED_PEOPLE.frontDesk.id,
      ],
    );
    try {
      await page.clock.install();
      await page.goto(`${APP}/calendar?day=${day}`);
      const block = page.locator('li[data-status]');
      await expect(block).toHaveCount(1);
      await hydrated(page, chips(page).first());
      // The 24-hour clock in the browser too (acceptance 7): the visit's time and the grid's hours.
      await expect(block).toContainText('09:00');
      await expect(block).toContainText('Checkup');
      await expect(page.getByText('08:00', { exact: true })).toBeVisible();
      await expect(page.getByText('17:00', { exact: true })).toBeVisible();

      // From here the page's clock moves only when the check moves it.
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
      const sent = countRequests(page);
      await db.query(`update appointments set title = 'Filling' where id = $1`, [added?.id]);

      // 21 seconds after the page's read: a use sends nothing, and the day stays as read.
      await page.clock.fastForward(20_000);
      await usePage(page);
      // A read would have been sent at once: the wait proves only that none comes.
      await page.waitForTimeout(500);
      expect(sent.reads(), 'no read before 30 seconds').toBe(0);
      await expect(block).toContainText('Checkup');

      // 31 seconds after it: the next use reads the day again, once, and the change shows.
      await page.clock.fastForward(10_000);
      await usePage(page);
      await expect(block).toContainText('Filling');
      expect(sent.reads(), 'one read on the use 30 seconds after the last').toBe(1);
      await usePage(page);
      expect(sent.reads(), 'no second read right after it').toBe(1);

      // Left alone for two minutes, every timer of the page run: no request at all.
      const before = sent.all.length;
      await page.clock.runFor(120_000);
      expect(sent.all.slice(before), 'nothing sent by a page nobody uses').toEqual([]);
    } finally {
      await db.query(`delete from appointments where id = $1`, [added?.id]);
    }
  });

  test('with the session ended, the next use shows the login page (acceptance 4)', async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await page.goto(`${APP}/calendar?day=${MONDAY}`);
    await hydrated(page, chips(page).first());
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
    // The browser drops the session's cookie when the session ends (D-067): this context's own
    // copy only, never the shared session of the other checks.
    await context.clearCookies();
    await page.clock.fastForward(31_000);
    await usePage(page);
    await page.clock.resume();
    await expect(page).toHaveURL(`${APP}/login`);
    await expect(page.getByRole('button', { name: messages.login.submit })).toBeVisible();
  });
});

test.describe('the "now" line (acceptance 5), the browser in a zone behind UTC', () => {
  // The browser's own zone plays no part: the line is at the clinic's time, in Skopje.
  test.use({ timezoneId: 'America/New_York' });

  const line = (page: Page) => page.locator('[data-now-line]');
  const topOf = (element: Locator) => element.evaluate((node) => (node as HTMLElement).style.top);

  test("at the clinic's time on its today, moved each minute without a request; none on another day", async ({
    page,
  }) => {
    await page.clock.install({ time: skopje(MONDAY, '09:59') });
    await page.goto(`${APP}/calendar?day=${MONDAY}`);
    await hydrated(page, chips(page).first());
    await page.clock.pauseAt(skopje(MONDAY, '10:00'));
    const sent = countRequests(page);

    const tenOClock = page.getByText('10:00', { exact: true });
    await expect(line(page)).toHaveCount(1);
    await expect.poll(() => topOf(line(page))).toBe(await topOf(tenOClock));

    await page.clock.runFor(60_000);
    const atTen = Number.parseFloat(await topOf(tenOClock));
    await expect
      .poll(async () => Number.parseFloat(await topOf(line(page))))
      .toBeCloseTo(atTen + 1.45);
    expect(sent.all, 'the line moved without a request').toEqual([]);

    await dayLink(page, t.nextDay).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tuesday, March 4, 2031');
    await expect(line(page)).toHaveCount(0);
  });

  test('none while the time is outside the grid', async ({ page }) => {
    await page.clock.install({ time: skopje(MONDAY, '20:30') });
    await page.goto(`${APP}/calendar?day=${MONDAY}`);
    await hydrated(page, chips(page).first());
    await expect(page.getByText('17:00', { exact: true })).toBeVisible();
    await expect(line(page)).toHaveCount(0);
  });
});
