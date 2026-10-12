import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from '@playwright/test';
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

  test('a day Back or Forward shows again is as old as its read: the first use 30 seconds after that read reads it, not a use before', async ({
    page,
  }, testInfo: TestInfo) => {
    // E01-T04b tester, finding 1: Next.js's router keeps a day it showed and shows it again on Back
    // and Forward, without a request. Each browser's own day, and the day after it, which no other
    // check writes on.
    const own: Record<string, { day: string; next: string; title: string }> = {
      chromium: { day: '2031-03-17', next: '2031-03-18', title: 'Monday, March 17, 2031' },
      firefox: { day: '2031-03-19', next: '2031-03-20', title: 'Wednesday, March 19, 2031' },
      webkit: { day: '2031-03-24', next: '2031-03-25', title: 'Monday, March 24, 2031' },
    };
    const days = own[testInfo.project.name];
    if (!days) throw new Error(`No day for the browser ${testInfo.project.name}.`);
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
        skopje(days.day, '09:00'),
        skopje(days.day, '09:30'),
        SEEDED_PEOPLE.frontDesk.id,
      ],
    );
    const heading = page.getByRole('heading', { level: 1 });
    const block = page.locator('li[data-status]');
    const answered = () =>
      page.waitForResponse((response) => {
        const request = response.request();
        return request.method() === 'POST' && request.headers()['next-action'] !== undefined;
      });
    try {
      await page.clock.install();
      await page.goto(`${APP}/calendar?day=${days.day}`);
      await expect(block).toContainText('Checkup');
      await hydrated(page, chips(page).first());
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
      const sent = countRequests(page);

      // Next, then Back a moment later: the day shown again was read a second ago, so a use does not
      // read it.
      await dayLink(page, t.nextDay).click();
      await expect(page).toHaveURL(`${APP}/calendar?day=${days.next}`);
      await page.goBack();
      await expect(heading).toHaveText(days.title);
      await usePage(page);
      await page.waitForTimeout(500);
      expect(sent.reads(), 'no read of a day read a second ago').toBe(0);

      // Forward to the next day, the appointment changed, a minute on, Back: the day shown again is
      // the one read a minute before, and the first use reads it.
      await page.goForward();
      await expect(page).toHaveURL(`${APP}/calendar?day=${days.next}`);
      await db.query(`update appointments set title = 'Filling' where id = $1`, [added?.id]);
      await page.clock.fastForward(60_000);
      await page.goBack();
      await expect(heading).toHaveText(days.title);
      await expect(block).toContainText('Checkup');
      await usePage(page);
      await expect(block).toContainText('Filling');
      expect(sent.reads(), 'Back: one read on the first use').toBe(1);
      await usePage(page);
      expect(sent.reads(), 'no second read right after it').toBe(1);

      // Forward: the next day, read over a minute ago, is read on the first use too.
      await page.goForward();
      await expect(page).toHaveURL(`${APP}/calendar?day=${days.next}`);
      const read = answered();
      await usePage(page);
      await read;
      expect(sent.reads(), 'Forward: one read on the first use').toBe(2);
      await usePage(page);
      expect(sent.reads(), 'no second read right after it').toBe(2);
      await page.waitForLoadState('networkidle');
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

// E01-T04b tester: what the checks above leave out. Focus and a visible window as uses; the two
// notices of a read that gives no day (a failed request, another tab's clinic); a pointer resting on
// the page while the "now" line moves under it; and the 24-hour clock drawn by the browser itself, at
// midnight, on the calendar and in the patient list's rows a search brings.

/** The calendar's read on use: a POST to the calendar's address (its only server action). */
const isRead = (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/calendar';

/** Opens the calendar on `day`, hydrated, its clock paused a second on; counts from then. */
async function openPaused(page: Page, day: string): Promise<ReturnType<typeof countRequests>> {
  await page.clock.install();
  await page.goto(`${APP}/calendar?day=${day}`);
  await hydrated(page, chips(page).first());
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  return countRequests(page);
}

test.describe('a fresh day: the other uses, and a read that gives no day (tester)', () => {
  test('the window regaining focus, or becoming visible, reads the day: once 30 seconds after the last read', async ({
    page,
  }) => {
    const sent = await openPaused(page, MONDAY);
    const answered = () => page.waitForResponse((response) => isRead(response.request()));

    await page.clock.fastForward(20_000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(500);
    expect(sent.reads(), 'no read before 30 seconds').toBe(0);

    await page.clock.fastForward(11_000);
    const afterFocus = answered();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await afterFocus;
    expect(sent.reads(), 'focus: one read').toBe(1);
    await page.waitForLoadState('networkidle');

    await page.clock.fastForward(31_000);
    const afterVisible = answered();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await afterVisible;
    expect(sent.reads(), 'a visible window: one read more').toBe(2);
    await page.waitForLoadState('networkidle');
  });

  test('a read that fails says so above the grid; the next use 30 seconds later reads again and clears it', async ({
    page,
  }) => {
    const sent = await openPaused(page, MONDAY);
    const failing = (route: Route) =>
      isRead(route.request()) ? route.abort('connectionfailed') : route.fallback();
    await page.route(`${APP}/calendar**`, failing);

    await page.clock.fastForward(31_000);
    await usePage(page);
    await expect(page.getByText(t.readFailed)).toBeVisible();
    // The day is still drawn, as the page read it.
    await expect(columns(page)).toHaveCount(3);
    expect(sent.reads()).toBe(1);

    await page.unroute(`${APP}/calendar**`, failing);
    await page.clock.fastForward(31_000);
    await usePage(page);
    await expect(page.getByText(t.readFailed)).toHaveCount(0);
    expect(sent.reads()).toBe(2);
    await page.waitForLoadState('networkidle');
  });

  test('another tab switched clinic: the read says so with a reload, and the day stays as read', async ({
    page,
  }) => {
    const sent = await openPaused(page, MONDAY);
    // The server sees the call as another tab's switch makes it: the request resolves to another
    // clinic than the one the call names (D-069). The frame's id is replaced in the call's body by
    // the second seeded clinic's, which the front desk does not belong to.
    let replaced = 0;
    await page.route(`${APP}/calendar**`, async (route) => {
      const request = route.request();
      if (!isRead(request)) return route.fallback();
      const body = request.postData() ?? '';
      if (body.includes(SEEDED_CLINICS.harbourStreet)) replaced++;
      await route.continue({
        postData: body.replaceAll(SEEDED_CLINICS.harbourStreet, SEEDED_CLINICS.soncogled),
      });
    });

    await page.clock.fastForward(31_000);
    await usePage(page);
    await expect(page.getByText(t.clinicChanged)).toBeVisible();
    await expect(page.getByRole('button', { name: messages.form.reload })).toBeVisible();
    expect(replaced, 'the call named the frame clinic').toBe(1);
    expect(sent.reads()).toBe(1);
    await expect(columns(page)).toHaveCount(3);
    await page.waitForLoadState('networkidle');
  });
});

test.describe('a pointer resting on the page (tester, D-108)', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('while the "now" line moves under it for three minutes, the page sends nothing', async ({
    page,
  }) => {
    await page.clock.install({ time: skopje(MONDAY, '09:59') });
    await page.goto(`${APP}/calendar?day=${MONDAY}`);
    await hydrated(page, chips(page).first());
    await page.clock.pauseAt(skopje(MONDAY, '10:00'));
    const line = page.locator('[data-now-line]');
    await expect(line).toHaveCount(1);

    // The pointer comes to rest a few pixels under the line, in the first column: that move is a
    // use, and may read the day once.
    const box = await line.boundingBox();
    if (!box) throw new Error('The "now" line has no box.');
    await page.mouse.move(box.x + 40, box.y + 3);
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle');
    const sent = countRequests(page);

    for (let minute = 1; minute <= 3; minute++) {
      await page.clock.runFor(60_000);
      // Real time for the browser to draw the moved line, and to do what it does under a pointer.
      await page.waitForTimeout(1_000);
    }
    const moved = await line.boundingBox();
    expect(moved?.y, 'the line moved under the pointer').toBeGreaterThan(box.y + 4);
    expect(sent.all, 'nothing sent while the pointer rests').toEqual([]);
  });
});

test.describe('the 24-hour clock drawn by the browser, at midnight (acceptance 7, tester)', () => {
  /** A weekday of each browser's own, so the three runs never share a row. */
  const MIDNIGHT_DAY: Record<string, { day: string; next: string }> = {
    chromium: { day: '2031-03-11', next: 'Tue, Mar 11, 00:30' },
    firefox: { day: '2031-03-12', next: 'Wed, Mar 12, 00:30' },
    webkit: { day: '2031-03-13', next: 'Thu, Mar 13, 00:30' },
  };

  let db: pg.Pool;
  test.beforeAll(() => {
    db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
  });
  test.afterAll(async () => {
    await db.end();
  });

  test('a visit at 00:30: "00:30" in the rows a search brings, "00:00" and "00:30" on the calendar', async ({
    page,
  }, testInfo: TestInfo) => {
    const own = MIDNIGHT_DAY[testInfo.project.name];
    if (!own) throw new Error(`No day for the browser ${testInfo.project.name}.`);
    // An invented patient of this browser's own, found by a name no other row has.
    const lastName = `Clock${testInfo.project.name}`;
    const {
      rows: [patient],
    } = await db.query<{ id: string }>(
      `insert into patients (id, clinic_id, first_name, last_name, language)
       values (gen_random_uuid(), $1, 'Marker', $2, 'en') returning id`,
      [SEEDED_CLINICS.harbourStreet, lastName],
    );
    try {
      await db.query(
        `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                                   status, source, created_by)
         values (gen_random_uuid(), $1, $2, $3, 'Checkup', $4, $5, 'booked', 'staff', $6)`,
        [
          SEEDED_CLINICS.harbourStreet,
          patient?.id,
          SEEDED_PROVIDERS.harbourStreetHygienist,
          skopje(own.day, '00:30'),
          skopje(own.day, '01:00'),
          SEEDED_PEOPLE.frontDesk.id,
        ],
      );

      // The rows a search brings are drawn in the browser, by its own Intl.
      await page.goto(`${APP}/patients`);
      const search = page.getByLabel(messages.patients.search);
      await hydrated(page, search);
      await search.fill(lastName);
      const row = page.getByRole('row').filter({ hasText: lastName });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell').nth(2)).toHaveText(own.next);

      await page.goto(`${APP}/calendar?day=${own.day}`);
      await hydrated(page, chips(page).first());
      const block = page.locator('li[data-status]');
      await expect(block).toHaveCount(1);
      await expect(block).toContainText('00:30');
      await expect(block).not.toContainText(/AM|PM|24:30/);
      await expect(page.getByText('00:00', { exact: true })).toBeVisible();
      await page.waitForLoadState('networkidle');
    } finally {
      await db.query(`delete from appointments where patient_id = $1`, [patient?.id]);
      await db.query(`delete from patients where id = $1`, [patient?.id]);
    }
  });
});
