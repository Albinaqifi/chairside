import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { expectNoAxeViolations } from './axe.ts';
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T06f in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): the appointment drawer's move form. Which visits have it; a move to
// another time, another provider and another day, each written once (the database says so) and a
// confirmed visit booked after it; the warning box on the day the calendar holds (a break, the hours,
// an overlap, the visit's own old place never) and on another day, whose read the checks hold or fail
// with page.route (the last answer wins, the old warnings stay until the new one comes, a failed read
// empties the box); the refusals above the button; a double click on Move; Escape and the overlay
// while a move is on its way; the keyboard, the focus back on the block and the accessibility check
// with a warning showing. Each check works on days of its own in a week of its browser's own, and
// removes what it wrote. The visits are written as the migration role, as appointment-drawer.spec.ts
// writes its rows. "Closed" is a weekend day (no opening hours): the closed days list belongs to
// closed-days.spec.ts. A provider made inactive meanwhile is tried in the second seeded clinic, as the
// seeded owner, on a provider the check writes itself and removes (the first clinic's providers are
// the columns the other specs count, as provider-edit.spec.ts says). Names are the seed's invented
// ones; the assertions on the database name ids and statuses only.

const t = messages.calendar.appointment;
const move = t.move;
const warn = messages.calendar.booking.warning;
const status = messages.appointmentStatus;

const DENTIST = SEEDED_PROVIDERS.harbourStreetDentist; // Dr. Planinska, lunch 12:00-13:00
const HYGIENIST = SEEDED_PROVIDERS.harbourStreetHygienist; // M. Lumi
const DAY_MS = 24 * 60 * 60 * 1000;

const BROWSERS = ['chromium', 'firefox', 'webkit'];
const CHECKS = [
  'shape',
  'moves',
  'shown',
  'other',
  'late',
  'failed',
  'refusals',
  'double',
  'keys',
  'inactive',
] as const;
type Check = (typeof CHECKS)[number];

/**
 * The days a check of a browser works on: a week of its own (the checks and browsers take turns from
 * Monday 3 January 2033), `main` a Tuesday, `other` a Thursday, `far` a Friday, then the weekend,
 * which the clinic has no hours on. No other spec uses 2033.
 */
function daysOf(testInfo: TestInfo, check: Check) {
  const browser = BROWSERS.indexOf(testInfo.project.name);
  if (browser < 0) throw new Error(`No days for the browser ${testInfo.project.name}.`);
  const monday = Date.UTC(2033, 0, 3) + (CHECKS.indexOf(check) * 3 + browser) * 7 * DAY_MS;
  const at = (n: number) => new Date(monday + n * DAY_MS).toISOString().slice(0, 10);
  return { main: at(1), other: at(3), far: at(4), saturday: at(5), sunday: at(6) };
}

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

/** A visit as the migration role writes it: the patient of that name, a provider, a local start. */
async function visit(
  day: string,
  start: string,
  options: {
    patient?: [string, string];
    provider?: string;
    minutes?: number;
    status?: string;
  } = {},
): Promise<string> {
  const [first, last] = options.patient ?? ['Mimoza', 'Kodra'];
  const state = options.status ?? 'booked';
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by, confirmed_at, confirmed_via)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + $3::time) at time zone 'Europe/Skopje',
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => $5),
            $6, 'staff', $7,
            case when $6 = 'confirmed' then now() end, case when $6 = 'confirmed' then 'staff' end
       from patients p
      where p.clinic_id = $1 and p.first_name = $8 and p.last_name = $9
     returning id`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      start,
      options.provider ?? DENTIST,
      options.minutes ?? 30,
      state,
      SEEDED_PEOPLE.frontDesk.id,
      first,
      last,
    ],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error(`The seed has no one ${first} ${last}.`);
  return rows[0].id;
}

/** Removes what a check wrote on these days, with the audit rows of those visits. */
async function clear(...days: string[]): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = any($2::date[])`,
    [SEEDED_CLINICS.harbourStreet, days],
  );
}

interface Stored {
  provider: string;
  /** The local start: `YYYY-MM-DD HH:MM` in the clinic's zone. */
  at: string;
  status: string;
  confirmed: boolean;
  overlapOk: boolean;
}

async function stored(id: string): Promise<Stored | undefined> {
  const { rows } = await db.query<Stored>(
    `select provider_id as provider,
            to_char(starts_at at time zone 'Europe/Skopje', 'YYYY-MM-DD HH24:MI') as at,
            status, confirmed_at is not null as confirmed, overlap_ok as "overlapOk"
       from appointments where id = $1`,
    [id],
  );
  return rows[0];
}

async function movedRows(id: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'appointment.moved' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return Number(rows[0]?.n);
}

/** The visit's block on the grid, a button, by the patient's name. */
const block = (page: Page, name = 'Mimoza Kodra') =>
  page.locator('button[data-appointment]').filter({ hasText: name });

/** The open drawer, named by the patient. */
const drawer = (page: Page, name = 'Mimoza Kodra') => page.getByRole('dialog', { name });

/** The status pill of the drawer. */
const pill = (open: Locator) => open.locator('[data-slot="badge"]');

const dayField = (open: Locator) => open.getByLabel(move.day, { exact: true });
const timeField = (open: Locator) => open.getByLabel(move.start, { exact: true });
const providerField = (open: Locator) => open.getByLabel(move.provider, { exact: true });
const moveButton = (open: Locator, name: string = move.submit) =>
  open.getByRole('button', { name, exact: true });

/** A message with its `{placeholders}` filled. */
function say(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

const overlapLine = (name: string, from: string, to: string) =>
  say(warn.overlap, { name, from, to });
const breakLine = (from: string, to: string) =>
  say(warn.break, { provider: 'Dr. Planinska', label: 'Lunch', from, to });
const weekdayLine = (weekday: string) => say(warn.noHours, { weekday });

/** A date as the toast names it: a date, in UTC, with the year (not the clinic's current year). */
function dateText(day: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day));
}

/** Opens the calendar on `day` once React has hydrated the visit's block and the page has settled. */
async function openCalendar(page: Page, day: string, name = 'Mimoza Kodra'): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const button = block(page, name).first();
  await expect(button).toBeVisible();
  await expect
    .poll(
      () =>
        button.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the calendar' },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

/** Opens a visit's drawer and lets its half second pass: a press sooner is a double click's second. */
async function openDrawer(page: Page, name = 'Mimoza Kodra'): Promise<Locator> {
  await block(page, name).click();
  const open = drawer(page, name);
  await expect(open).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return open;
}

/**
 * Closes the open drawer with Escape. A toast showing at the time takes the first Escape (Radix's toast
 * is a layer above the drawer's), so the key is pressed again until the drawer is gone.
 */
async function closeDrawer(page: Page, open: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(open).toBeHidden({ timeout: 700 });
  }).toPass({ timeout: 8_000 });
}

/** True for the request of a move: a server action that carries an appointment and a provider. */
function isMove(request: Request): boolean {
  const body = request.postData() ?? '';
  return (
    request.method() === 'POST' &&
    request.headers()['next-action'] !== undefined &&
    body.includes('appointmentId') &&
    body.includes('providerId')
  );
}

/** The bodies of the moves the page sends from now on. */
function movesSent(page: Page): string[] {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (isMove(request)) bodies.push(request.postData() ?? '');
  });
  return bodies;
}

/** The toast region, which the open drawer hides from a screen reader (includeHidden). */
const toasts = (page: Page) =>
  page.getByRole('region', { name: 'Notifications (F8)', includeHidden: true });

/** The status requests that read a day: a server action whose body names it and no appointment. */
function readsOf(request: Request, day: string): boolean {
  const body = request.postData() ?? '';
  return (
    request.method() === 'POST' &&
    request.headers()['next-action'] !== undefined &&
    body.includes(day) &&
    !body.includes('appointmentId')
  );
}

test.describe('which visits have the form (acceptance 1)', () => {
  test('a booked and a confirmed visit show it with their own date, time and provider; an arrived, completed, cancelled and no-show one show none', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'shape');
    try {
      await visit(main, '08:00', { patient: ['Ana', 'Brezovska'] });
      await visit(main, '08:30', { patient: ['Bojan', 'Kamenov'], status: 'confirmed' });
      await visit(main, '09:00', { patient: ['Elena', 'Kodra'], status: 'arrived' });
      await visit(main, '09:30', { patient: ['Marko', 'Ezerovski'], status: 'completed' });
      await visit(main, '10:00', { patient: ['Mimoza', 'Kodra'], status: 'cancelled' });
      await visit(main, '10:30', { patient: ['Ana', 'Lumi'], status: 'no_show' });
      await openCalendar(page, main, 'Ana Brezovska');

      const cases: [string, string | null][] = [
        ['Ana Brezovska', '08:00'],
        ['Bojan Kamenov', '08:30'],
        ['Elena Kodra', null],
        ['Marko Ezerovski', null],
        ['Mimoza Kodra', null],
        ['Ana Lumi', null],
      ];
      for (const [name, time] of cases) {
        const open = await openDrawer(page, name);
        if (time === null) {
          await expect(open.getByRole('heading', { name: move.heading }), name).toHaveCount(0);
          await expect(dayField(open), name).toHaveCount(0);
          await expect(moveButton(open), name).toHaveCount(0);
        } else {
          await expect(open.getByRole('heading', { name: move.heading })).toBeVisible();
          await expect(dayField(open)).toHaveValue(main);
          await expect(timeField(open)).toHaveValue(time);
          await expect(providerField(open)).toHaveValue(DENTIST);
          await expect(moveButton(open)).toBeVisible();
        }
        await page.keyboard.press('Escape');
        await expect(open).toBeHidden();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      }
    } finally {
      await clear(main);
    }
  });
});

test.describe('a move (acceptance 2)', () => {
  test('to another time, another provider and another day: each written once, the pill booked, the visit in its new place with the drawer open, then off the day with the toast', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other } = daysOf(testInfo, 'moves');
    try {
      const id = await visit(main, '09:00', { status: 'confirmed' });
      expect((await stored(id))?.confirmed).toBe(true);
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await expect(pill(open)).toHaveText(status.confirmed);
      // The visit's own old place is no overlap: 09:00 to 09:15 with the same provider warns of nothing.
      await timeField(open).selectOption('09:15');
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await moveButton(open).click();
      await expect(pill(open), 'a moved visit is booked again').toHaveText(status.booked);
      await expect(open).toContainText('· 09:15–09:45');
      await expect(open, 'the drawer stays open').toBeVisible();
      await expect(page.locator('li[data-status]')).toHaveAttribute('data-status', 'booked');
      expect(await stored(id)).toEqual({
        provider: DENTIST,
        at: `${main} 09:15`,
        status: 'booked',
        confirmed: false,
        overlapOk: false,
      });
      expect(await movedRows(id)).toBe(1);
      // The form starts again from the new place.
      await expect(timeField(open)).toHaveValue('09:15');

      // Another provider and time, on the same day.
      await providerField(open).selectOption({ label: 'M. Lumi' });
      await timeField(open).selectOption('10:00');
      await moveButton(open).click();
      await expect(open).toContainText('· 10:00–10:30');
      await expect(open).toContainText('M. Lumi');
      expect(await stored(id)).toMatchObject({ provider: HYGIENIST, at: `${main} 10:00` });
      expect(await movedRows(id)).toBe(2);
      await expect(providerField(open)).toHaveValue(HYGIENIST);

      // Another day: the visit leaves the day, the drawer closes and the toast names where it went.
      await dayField(open).fill(other);
      await timeField(open).selectOption('11:15');
      await moveButton(open).click();
      await expect(open).toBeHidden();
      await expect(block(page)).toHaveCount(0);
      await expect(
        toasts(page).getByText(
          say(move.moved, { name: 'Mimoza Kodra', day: dateText(other), time: '11:15' }),
        ),
      ).toBeVisible();
      expect(await stored(id)).toMatchObject({ provider: HYGIENIST, at: `${other} 11:15` });
      expect(await movedRows(id)).toBe(3);
    } finally {
      await clear(main, other);
    }
  });
});

test.describe('the warning box on the day the calendar holds (acceptance 3)', () => {
  test('an overlap turns Move into Move anyway and sends anyway, a break and the hours leave Move as it is, back to back is no overlap; the next move without an overlap clears it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'shown');
    try {
      const id = await visit(main, '09:00');
      await visit(main, '10:00', { patient: ['Ana', 'Brezovska'] });
      await openCalendar(page, main);
      const sent = movesSent(page);
      const open = await openDrawer(page);
      const anyway = open.locator('input[name="anyway"]');
      await expect(open.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);

      await timeField(open).selectOption('10:00');
      await expect(open.getByText(overlapLine('Ana Brezovska', '10:00', '10:30'))).toBeVisible();
      await expect(open.getByText(warn.moveAnyway)).toBeVisible();
      await expect(moveButton(open, move.moveAnyway)).toBeVisible();
      await expect(moveButton(open)).toHaveCount(0);
      await expect(anyway).toHaveCount(1);

      // Back to back with the other visit: no overlap.
      await timeField(open).selectOption('10:30');
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await expect(moveButton(open)).toBeVisible();
      await expect(anyway).toHaveCount(0);

      // The dentist's lunch, and a start whose end is outside the day's hours.
      await timeField(open).selectOption('12:00');
      await expect(open.getByText(breakLine('12:00', '13:00'))).toBeVisible();
      await expect(moveButton(open)).toBeVisible();
      await expect(anyway).toHaveCount(0);
      await timeField(open).selectOption('17:45');
      await expect(
        open.getByText(say(warn.outsideHours, { from: '08:00', to: '18:00' })),
      ).toBeVisible();
      await expect(moveButton(open)).toBeVisible();

      // The other dentist has no visit at 10:00.
      await timeField(open).selectOption('10:00');
      await providerField(open).selectOption({ label: 'Dr. Kodra' });
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await providerField(open).selectOption({ label: 'Dr. Planinska' });

      // Move anyway over the overlap: written once, with the overlap kept on the row.
      await expect(moveButton(open, move.moveAnyway)).toBeVisible();
      await moveButton(open, move.moveAnyway).click();
      await expect(open).toContainText('· 10:00–10:30');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain('anyway');
      expect(await stored(id)).toMatchObject({ at: `${main} 10:00`, overlapOk: true });
      expect(await movedRows(id)).toBe(1);

      // To a free place: the anyway is not sent and the row is clear of it.
      await timeField(open).selectOption('14:00');
      await expect(anyway).toHaveCount(0);
      await moveButton(open).click();
      await expect(open).toContainText('· 14:00–14:30');
      expect(sent).toHaveLength(2);
      expect(sent[1]).not.toContain('anyway');
      expect(await stored(id)).toMatchObject({ at: `${main} 14:00`, overlapOk: false });
    } finally {
      await clear(main);
    }
  });

  test('another day: its warnings come from its own read, a day without hours is closed, Move anyway moves over an overlap there and closes the drawer', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, far, saturday } = daysOf(testInfo, 'other');
    try {
      const id = await visit(main, '09:00');
      await visit(far, '10:00', { patient: ['Ana', 'Brezovska'] });
      await openCalendar(page, main);
      const open = await openDrawer(page);

      await dayField(open).fill(saturday);
      await expect(open.getByText(weekdayLine('Saturday'))).toBeVisible();
      await expect(moveButton(open)).toBeVisible();

      await dayField(open).fill(far);
      await expect(open.getByText(weekdayLine('Saturday'))).toHaveCount(0);
      await timeField(open).selectOption('10:00');
      await expect(open.getByText(overlapLine('Ana Brezovska', '10:00', '10:30'))).toBeVisible();
      await expect(moveButton(open, move.moveAnyway)).toBeVisible();
      await expect(open.locator('input[name="anyway"]')).toHaveCount(1);

      // Back on the day the calendar holds: its own, the visit's old place no overlap.
      await dayField(open).fill(main);
      await timeField(open).selectOption('09:15');
      await expect(open.getByText('Overlaps')).toHaveCount(0);

      await dayField(open).fill(far);
      await timeField(open).selectOption('10:00');
      await moveButton(open, move.moveAnyway).click();
      await expect(open).toBeHidden();
      expect(await stored(id)).toMatchObject({ at: `${far} 10:00`, overlapOk: true });
      expect(await movedRows(id)).toBe(1);
    } finally {
      await clear(main, far);
    }
  });

  test('the date changed twice, the first answer late: the old warnings stay until an answer comes, and the first answer, when it comes, is never shown', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, saturday, sunday } = daysOf(testInfo, 'late');
    // The Saturday's read is held while the date changes to Sunday. Next.js sends the page's server
    // actions one after the other, so the Sunday's read waits behind it: the Saturday's answer is the
    // one that comes late, after the form points at Sunday.
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route(`${APP}/calendar**`, async (route) => {
      if (!readsOf(route.request(), saturday)) return route.fallback();
      held++;
      await released;
      return route.continue();
    });
    try {
      await visit(main, '09:00');
      await visit(main, '10:00', { patient: ['Ana', 'Brezovska'] });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await timeField(open).selectOption('10:00');
      const kept = open.getByText(overlapLine('Ana Brezovska', '10:00', '10:30'));
      await expect(kept).toBeVisible();

      await dayField(open).fill(saturday);
      await expect.poll(() => held, { message: "the Saturday's read is sent, and held" }).toBe(1);
      await expect(kept, 'the old warnings stay until the answer comes').toBeVisible();
      await expect(moveButton(open, move.moveAnyway)).toBeVisible();

      // What is shown under the dialog from now on, whatever it is for a moment.
      await page.evaluate((saturdayText) => {
        const seen: string[] = [];
        (window as unknown as { seen: string[] }).seen = seen;
        new MutationObserver(() => {
          if (document.body.innerText.includes(saturdayText)) seen.push(saturdayText);
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      }, weekdayLine('Saturday'));

      await dayField(open).fill(sunday);
      await expect(kept, 'the old warnings stay while the Sunday is read').toBeVisible();

      // The Saturday's answer comes, late, and the Sunday's after it.
      release();
      await expect(open.getByText(weekdayLine('Sunday'))).toBeVisible();
      await expect(kept).toHaveCount(0);
      await expect(open.getByText(weekdayLine('Saturday'))).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as unknown as { seen: string[] }).seen),
        'the Saturday line was never on the page',
      ).toEqual([]);
    } finally {
      release();
      await clear(main);
    }
  });

  test('a read that does not work empties the box and says so; Move still checks, and a later read brings the warnings back', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other, saturday } = daysOf(testInfo, 'failed');
    await page.route(`${APP}/calendar**`, async (route) => {
      if (readsOf(route.request(), saturday)) return route.abort();
      return route.fallback();
    });
    try {
      const id = await visit(main, '09:00');
      await visit(main, '10:00', { patient: ['Ana', 'Brezovska'] });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await timeField(open).selectOption('10:00');
      await expect(open.getByText('Overlaps')).toBeVisible();

      await dayField(open).fill(saturday);
      await expect(open.getByText(move.couldNotCheck)).toBeVisible();
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await expect(open.locator('input[name="anyway"]')).toHaveCount(0);
      await expect(moveButton(open)).toBeVisible();

      // The next complete date is read, and the line goes.
      await dayField(open).fill(other);
      await expect(open.getByText(move.couldNotCheck)).toHaveCount(0);

      // Move still checks: back on the failed day, it is the server that answers (a Saturday has
      // no hours and the move is not refused for it).
      await dayField(open).fill(saturday);
      await expect(open.getByText(move.couldNotCheck)).toBeVisible();
      await moveButton(open).click();
      await expect(open).toBeHidden();
      expect(await stored(id)).toMatchObject({ at: `${saturday} 10:00` });
    } finally {
      await clear(main, saturday);
    }
  });
});

test.describe('the refusals above the button (acceptance 4)', () => {
  test('an overlap that arose after the box was drawn, nothing changed, and an empty date: each writes nothing; the overlap turns Move into Move anyway', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'refusals');
    try {
      const id = await visit(main, '09:00');
      await openCalendar(page, main);
      const open = await openDrawer(page);

      // Nothing changed.
      await moveButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(move.refusals.nothingChanged);
      expect(await movedRows(id)).toBe(0);

      // A date half typed is empty: the field says so.
      await dayField(open).fill('');
      await moveButton(open).click();
      await expect(open.getByText(messages.form.fieldErrors.missing)).toBeVisible();
      expect(await movedRows(id)).toBe(0);
      await dayField(open).fill(main);

      // Another desk books the slot after the box was drawn.
      await timeField(open).selectOption('10:00');
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await visit(main, '10:00', { patient: ['Ana', 'Brezovska'] });
      await moveButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(move.refusals.overlap);
      expect(await stored(id)).toMatchObject({ at: `${main} 09:00` });
      expect(await movedRows(id)).toBe(0);
      // The refusal brought the day again: the box names the visit and the button says Move anyway.
      await expect(open.getByText(overlapLine('Ana Brezovska', '10:00', '10:30'))).toBeVisible();
      await expect(moveButton(open, move.moveAnyway)).toBeVisible();
      await moveButton(open, move.moveAnyway).click();
      await expect(open).toContainText('· 10:00–10:30');
      expect(await stored(id)).toMatchObject({ at: `${main} 10:00`, overlapOk: true });
      expect(await movedRows(id)).toBe(1);
    } finally {
      await clear(main);
    }
  });
});

test.describe('a double click on Move, and a move on its way (acceptance 5)', () => {
  // At 1280 px the drawer covers the grid's right part and the form stays where it was measured.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('80, 150 and 250 ms apart: the visit moves once and no error shows', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'double');
    try {
      const id = await visit(main, '09:00');
      await openCalendar(page, main);
      const sent = movesSent(page);
      let rounds = 0;
      for (const [gap, time] of [
        [80, '10:00'],
        [150, '11:00'],
        [250, '14:00'],
      ] as const) {
        rounds += 1;
        const open = await openDrawer(page);
        await timeField(open).selectOption(time);
        const box = await moveButton(open).boundingBox();
        if (!box) throw new Error('The drawer has no Move button to point at.');
        const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(gap);
        await page.mouse.click(at.x, at.y);
        await expect(open).toContainText(`· ${time}–`);
        await page.waitForTimeout(1_500);
        expect(sent, `${gap} ms: one request more`).toHaveLength(rounds);
        expect(await movedRows(id), `${gap} ms: one audit row more`).toBe(rounds);
        expect(await stored(id)).toMatchObject({ at: `${main} ${time}` });
        await expect(open.getByRole('alert'), `${gap} ms: no error`).toHaveCount(0);
        await closeDrawer(page, open);
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      }
    } finally {
      await clear(main);
    }
  });

  test('Escape and the overlay leave the drawer open while the move is on its way', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'double');
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route(`${APP}/calendar**`, async (route) => {
      if (!isMove(route.request())) return route.fallback();
      held++;
      await released;
      return route.continue();
    });
    try {
      const id = await visit(main, '09:00');
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await timeField(open).selectOption('10:00');
      await moveButton(open).click();
      await expect.poll(() => held, { message: 'the move is sent, and held' }).toBe(1);

      await page.keyboard.press('Escape');
      await page.mouse.click(20, 400);
      await page.waitForTimeout(400);
      await expect(open, 'the drawer stays open while the move is on its way').toBeVisible();

      release();
      await expect(open).toContainText('· 10:00–10:30');
      expect(await stored(id)).toMatchObject({ at: `${main} 10:00` });
      await closeDrawer(page, open);
    } finally {
      release();
      await clear(main);
    }
  });
});

test.describe('the keyboard and the accessibility check (acceptance 6)', () => {
  test('Tab goes through the date, the time, the provider and Move; Enter moves; Escape gives the focus back to the block; axe passes with the form open and a warning showing', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'keys');
    try {
      const id = await visit(main, '09:00');
      await openCalendar(page, main);
      const open = await openDrawer(page);

      // A browser's date field has a stop for each of its parts: Tab until the time is reached.
      await dayField(open).focus();
      for (let presses = 0; presses < 6; presses += 1) {
        if (await timeField(open).evaluate((node) => node === document.activeElement)) break;
        await page.keyboard.press('Tab');
      }
      await expect(timeField(open)).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(providerField(open)).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(moveButton(open)).toBeFocused();

      // A warning showing (the dentist's lunch), then the accessibility check.
      await timeField(open).selectOption('12:00');
      await expect(open.getByText(breakLine('12:00', '13:00'))).toBeVisible();
      await expectNoAxeViolations(page);

      await moveButton(open).focus();
      await page.keyboard.press('Enter');
      await expect(open).toContainText('· 12:00–12:30');
      expect(await stored(id)).toMatchObject({ at: `${main} 12:00` });
      expect(await movedRows(id)).toBe(1);

      await closeDrawer(page, open);
      await expect(block(page), 'the focus is back on the block').toBeFocused();
    } finally {
      await clear(main);
    }
  });
});

test.describe('a provider made inactive meanwhile (acceptance 4)', () => {
  test.use({ storageState: OWNER_SESSION });

  // The second seeded clinic, on a provider of the check's own (sort_order 100, after the seed's), so
  // no other spec's column or choice changes, even for a moment.
  const SONCOGLED = SEEDED_CLINICS.soncogled;
  const SONCOGLED_NAME = 'Забна клиника Сончоглед';

  test('the form is open on the visit, the provider is made inactive, Move is pressed: the refusal shows above the button and nothing is written', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'inactive');
    const providerName = `Move ${testInfo.project.name} Mira Testova`;
    const removeOwn = async () => {
      await db.query(
        `delete from appointments where clinic_id = $1 and provider_id in
           (select id from providers where clinic_id = $1 and name = $2)`,
        [SONCOGLED, providerName],
      );
      await db.query(`delete from providers where clinic_id = $1 and name = $2`, [
        SONCOGLED,
        providerName,
      ]);
    };
    await removeOwn();
    try {
      const { rows: made } = await db.query<{ id: string }>(
        `insert into providers (id, clinic_id, name, short_name, kind, chair_label, color_hue, sort_order)
         values (gen_random_uuid(), $1, $2, $3, 'dentist', 'Chair 8', 40, 100) returning id`,
        [SONCOGLED, providerName, `M-${testInfo.project.name.slice(0, 3)}`],
      );
      const providerId = made[0]?.id;
      const { rows: patients } = await db.query<{ name: string }>(
        `select first_name || ' ' || last_name as name from patients
          where clinic_id = $1 and status = 'active' order by id limit 1`,
        [SONCOGLED],
      );
      const patient = patients[0]?.name;
      if (!providerId || !patient) throw new Error('The second clinic has no patient to book.');
      const { rows: booked } = await db.query<{ id: string }>(
        `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                                   status, source, created_by)
         select gen_random_uuid(), $1,
                (select id from patients where clinic_id = $1 and status = 'active' order by id limit 1),
                $2, 'Checkup', ($3::date + time '09:00') at time zone 'Europe/Skopje',
                ($3::date + time '09:30') at time zone 'Europe/Skopje', 'booked', 'staff',
                (select user_id from memberships where clinic_id = $1 order by user_id limit 1)
         returning id`,
        [SONCOGLED, providerId, main],
      );
      const id = booked[0]?.id;
      if (!id) throw new Error('The visit was not written.');
      const state = async () => {
        const { rows } = await db.query<{ provider: string; at: string; status: string }>(
          `select provider_id as provider,
                  to_char(starts_at at time zone 'Europe/Skopje', 'YYYY-MM-DD HH24:MI') as at, status
             from appointments where id = $1`,
          [id],
        );
        return rows[0];
      };
      const movedAudits = async () => {
        const { rows } = await db.query<{ n: string }>(
          `select count(*) as n from audit_log
            where clinic_id = $1 and action = 'appointment.moved' and entity_id = $2`,
          [SONCOGLED, id],
        );
        return Number(rows[0]?.n);
      };

      await page.goto(`${APP}/choose-clinic`);
      await page.getByRole('button', { name: SONCOGLED_NAME }).click();
      await expect(page).toHaveURL(`${APP}/`);
      await openCalendar(page, main, patient);
      const open = await openDrawer(page, patient);
      await expect(providerField(open)).toHaveValue(providerId);

      // Another desk makes the provider inactive; this page does not know. Then a new time and Move.
      await timeField(open).selectOption('10:00');
      await db.query(`update providers set active = false where id = $1`, [providerId]);
      await moveButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(move.refusals.providerNotBookable);
      expect(await state()).toEqual({
        provider: providerId,
        at: `${main} 09:00`,
        status: 'booked',
      });
      expect(await movedAudits()).toBe(0);
      await expect(open).toBeVisible();
    } finally {
      await removeOwn();
    }
  });
});
