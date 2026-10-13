import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { LOCALE } from '@/i18n/locale';
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T08c, test finding 1 (`message`), in real browsers, on the production build, as the seeded
// owner (the global setup's session; no sign-in of its own): a double click on a closed day's Remove
// removes that day only. The first click's answer can come back before the second click: its row
// leaves, and another day's Remove is then where the pointer rests, the next day's while the page
// keeps its place, the day before's when the page was scrolled to its end (the shorter page scrolls
// back a row). Each check closes days of its browser's own, in June 2032, far from the days the other
// checks write on (calendar.spec.ts: March 2031), and opens again whatever is left. The list is the
// clinic's, one for all three browsers, and a row another browser adds or removes moves this page's
// rows at its next render: the checks take the list in turn (inTurn), so each one's rows move by its
// own clicks alone.

const t = messages.settings.hours.closedDays;

/** The seeded clinic the checks close days in, as the clinic picker names it. */
const CLINIC_NAME = 'Harbour Street Dental';

/** The days each browser closes, three a check, in date order: no other browser or check uses them. */
const DAYS: Record<string, Record<'inPlace' | 'atTheEnd', readonly [string, string, string]>> = {
  chromium: {
    inPlace: ['2032-06-01', '2032-06-02', '2032-06-03'],
    atTheEnd: ['2032-06-04', '2032-06-05', '2032-06-06'],
  },
  firefox: {
    inPlace: ['2032-06-08', '2032-06-09', '2032-06-10'],
    atTheEnd: ['2032-06-11', '2032-06-12', '2032-06-13'],
  },
  webkit: {
    inPlace: ['2032-06-15', '2032-06-16', '2032-06-17'],
    atTheEnd: ['2032-06-18', '2032-06-19', '2032-06-20'],
  },
};

function daysOf(
  testInfo: TestInfo,
  check: 'inPlace' | 'atTheEnd',
): readonly [string, string, string] {
  const days = DAYS[testInfo.project.name]?.[check];
  if (!days) throw new Error(`No days for the browser ${testInfo.project.name}.`);
  return days;
}

/** A closed day's date as the page shows it and names its row: "Tuesday, June 1, 2032" (D-098). */
const SHOWN_DATE = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const shownDate = (date: string) => SHOWN_DATE.format(new Date(date));

/** A closed day's row: a group named by its date. */
const dayRow = (page: Page, date: string) =>
  page.getByRole('group', { name: shownDate(date), exact: true });

/** A closed day's Remove. */
const removeOf = (page: Page, date: string) =>
  dayRow(page, date).getByRole('button', { name: t.remove, exact: true });

/** The lock the checks of every browser take in turn: a number the run uses for nothing else. */
const LIST_LOCK = 81_083;

let db: pg.Pool;
let turn: pg.Client;
test.beforeAll(async () => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
  // A connection of its own, held for the whole run of this file: the lock is its session's, and a
  // pool closes a connection left idle, which would let the lock go in the middle of a check.
  turn = new pg.Client({ connectionString: e2eDatabase().migratorUrl });
  await turn.connect();
});
test.afterAll(async () => {
  await turn.end();
  await db.end();
});

/**
 * Runs a check while no other browser's check changes the clinic's closed days: it waits for the
 * others' turns (each a few seconds), then holds the list until it has opened its days again.
 */
async function inTurn(check: () => Promise<void>): Promise<void> {
  await turn.query('select pg_advisory_lock($1)', [LIST_LOCK]);
  try {
    await check();
  } finally {
    await turn.query('select pg_advisory_unlock($1)', [LIST_LOCK]);
  }
}

/** Closes the seeded clinic on these days, for one check. */
async function closeDays(days: readonly string[]): Promise<void> {
  await db.query(
    `insert into closed_days (id, clinic_id, date, label)
     select gen_random_uuid(), $1, day, 'Closed for a check'
     from unnest($2::date[]) as day`,
    [SEEDED_CLINICS.harbourStreet, days],
  );
}

/** The ones of these days the clinic is closed on now, by date. */
async function stillClosed(days: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ date: string }>(
    `select date::text as date from closed_days
     where clinic_id = $1 and date = any($2::date[]) order by date`,
    [SEEDED_CLINICS.harbourStreet, days],
  );
  return rows.map((row) => row.date);
}

/** Opens these days again, whatever a check left closed. */
async function openDays(days: readonly string[]): Promise<void> {
  await db.query(`delete from closed_days where clinic_id = $1 and date = any($2::date[])`, [
    SEEDED_CLINICS.harbourStreet,
    days,
  ]);
}

/**
 * Settings → Opening hours as the owner, in the seeded clinic: the clinic picker first (the owner is
 * in both seeded clinics), then the page once its script runs. The Clinic tab's Save is disabled until
 * then (StaffForm, D-076), and a tab clicked before would not open.
 */
async function openClosedDays(page: Page): Promise<void> {
  await page.goto(`${APP}/choose-clinic`);
  await page.getByRole('button', { name: CLINIC_NAME }).click();
  await expect(page).toHaveURL(`${APP}/`);
  await page.goto(`${APP}/settings`);
  await expect(
    page.getByRole('button', { name: messages.settings.clinic.save, exact: true }),
  ).toBeEnabled();
  await page.getByRole('tab', { name: messages.settings.hours.tab }).click();
  await expect(page.getByRole('heading', { name: t.heading, exact: true })).toBeVisible();
}

/** The server actions the page sends from now on: on this page, each one a Remove. */
function actionsSent(page: Page): { count: () => number; answered: () => Promise<unknown> } {
  const sent: Request[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(APP) || request.method() !== 'POST') return;
    if (request.headers()['next-action'] !== undefined) sent.push(request);
  });
  return {
    count: () => sent.length,
    answered: () => Promise.all(sent.map((request) => request.response())),
  };
}

/** The middle of an element, where the pointer rests on it. */
async function middleOf(element: Locator): Promise<{ x: number; y: number }> {
  const box = await element.boundingBox();
  if (!box) throw new Error('The element has no box.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Whether a point of the viewport is inside an element's box. */
async function isUnder(element: Locator, point: { x: number; y: number }): Promise<boolean> {
  const box = await element.boundingBox();
  if (!box) return false;
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/**
 * Waits until the list takes the pointer at a day's Remove again, after the moment a change of its
 * rows starts: Playwright's trial hover waits until the button would get the pointer's events. While
 * it waits, it may scroll the button into view.
 */
async function takesThePointer(page: Page, date: string): Promise<void> {
  await removeOf(page, date).hover({ trial: true });
}

/** Rests the pointer on a day's Remove, where it is now (no wait, no scroll), and gives the spot. */
async function restOn(page: Page, date: string): Promise<{ x: number; y: number }> {
  const spot = await middleOf(removeOf(page, date));
  await page.mouse.move(spot.x, spot.y);
  return spot;
}

/**
 * A double click where the pointer rests on a day's Remove, its second click as soon as the first
 * one's row has left: the first answer back before the second click, as a fast answer brings it (the
 * tester's: 100–330 ms, clicks 150–250 ms apart). Waiting for the row, never a fixed time, makes the
 * case the same on every machine: a slower answer would meet the second click on the first row's own
 * Remove, disabled while it runs. The row is looked for at every frame. Before the second click, the
 * check that another day's Remove (`comesUnder`) is now where the pointer rests: the case itself.
 */
async function doubleClickAsTheRowLeaves(
  page: Page,
  date: string,
  spot: { x: number; y: number },
  comesUnder: Locator,
): Promise<void> {
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    (name) =>
      ![...document.querySelectorAll('[role="group"]')].some(
        (group) => group.getAttribute('aria-label') === name,
      ),
    shownDate(date),
    { polling: 'raf' },
  );
  expect(await isUnder(comesUnder, spot), "another day's Remove under the pointer").toBe(true);
  await page.mouse.down({ clickCount: 2 });
  await page.mouse.up({ clickCount: 2 });
}

/** After a double click: one Remove sent, and answered. The wait proves only that no second comes. */
async function expectOneRemove(
  page: Page,
  sent: { count: () => number; answered: () => Promise<unknown> },
): Promise<void> {
  await page.waitForTimeout(1_000);
  await sent.answered();
  expect(sent.count(), 'Removes sent for one double click').toBe(1);
}

test.describe("a double click on a closed day's Remove (E01-T08c test finding 1)", () => {
  test.use({ storageState: OWNER_SESSION });
  // A check may first wait for the other two browsers' turns.
  test.describe.configure({ timeout: 90_000 });

  test('the page keeps its place: that day removed, and the next day, moved up under the pointer, stays closed', async ({
    page,
  }, testInfo: TestInfo) => {
    const [warm, target, next] = daysOf(testInfo, 'inPlace');
    await inTurn(async () => {
      await closeDays([warm, target, next]);
      try {
        // Taller than the page: nothing scrolls, so the rows under a removed one move up.
        await page.setViewportSize({ width: 1280, height: 2400 });
        await openClosedDays(page);
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight),
          'the whole page on screen',
        ).toBe(true);
        // One Remove first, as the tester did: the page is warm, and its answers fast.
        await removeOf(page, warm).click();
        await expect(dayRow(page, warm)).toHaveCount(0);

        await takesThePointer(page, target);
        const spot = await restOn(page, target);
        const sent = actionsSent(page);
        // The next day's row moves up into the removed one's place.
        await doubleClickAsTheRowLeaves(page, target, spot, removeOf(page, next));
        await expectOneRemove(page, sent);
        await expect(dayRow(page, next)).toBeVisible();
        expect(await stillClosed([warm, target, next])).toEqual([next]);

        // A moment later, the next day's Remove removes its day: the list takes clicks again.
        await removeOf(page, next).click();
        await expect(dayRow(page, next)).toHaveCount(0);
        expect(await stillClosed([warm, target, next])).toEqual([]);
      } finally {
        await openDays([warm, target, next]);
      }
    });
  });

  test('the page scrolled to its end: that day removed, and the day before, brought under the pointer as the page scrolls back, stays closed', async ({
    page,
  }, testInfo: TestInfo) => {
    const [before, target, warm] = daysOf(testInfo, 'atTheEnd');
    await inTurn(async () => {
      await closeDays([before, target, warm]);
      try {
        await openClosedDays(page);
        await removeOf(page, warm).click();
        await expect(dayRow(page, warm)).toHaveCount(0);
        await takesThePointer(page, target);

        // A window a little taller than the closed days, which stand under the week: the page
        // scrolls, and at its end every closed day is on screen, so a shorter page scrolls back.
        const height = await page
          .getByRole('heading', { name: t.heading, exact: true })
          .evaluate((heading) => heading.closest('section')?.getBoundingClientRect().height ?? 0);
        expect(height, 'the closed days measured').toBeGreaterThan(0);
        await page.setViewportSize({ width: 1280, height: Math.ceil(height) + 200 });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect(removeOf(page, target)).toBeInViewport({ ratio: 1 });
        const spot = await restOn(page, target);
        const scroll = await page.evaluate(() => ({
          at: window.scrollY,
          end: document.documentElement.scrollHeight - window.innerHeight,
        }));
        expect(scroll.end, 'the page scrolls more than a row').toBeGreaterThan(100);
        expect(Math.abs(scroll.at - scroll.end), 'the page at its end').toBeLessThan(1);

        const sent = actionsSent(page);
        // The page, a row shorter, scrolls back a row: the day before comes down into the place.
        await doubleClickAsTheRowLeaves(page, target, spot, removeOf(page, before));
        await expectOneRemove(page, sent);
        await expect(dayRow(page, before)).toBeVisible();
        expect(await stillClosed([before, target, warm])).toEqual([before]);
      } finally {
        await openDays([before, target, warm]);
      }
    });
  });
});
