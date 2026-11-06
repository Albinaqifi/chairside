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
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T06h in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): the booking drawer's Day field and Book next visit. The Day field:
// a day weeks ahead and a day long past are booked (the row's start is that day in the clinic's
// zone, the toast names the day, the calendar keeps its own); what the day typed decides the closed
// line, the overlap box and Book or Book anyway; a changed day's read held with page.route (the old
// box stays, Book is Book, no `anyway` is sent; of two reads that cross only the last counts) or
// failed (the box empty, a line says so, the server still refuses an overlap); a blank day refused at
// its field; a provider made inactive between two reads replaced (the second seeded clinic, as its
// owner). Book next visit: the booking drawer opens on the patient, the visit's provider, the
// calendar's day, no treatment, from a booked, a completed and a cancelled visit; one booking, on a
// day weeks ahead (the rows and the audit say so); a double click leaves one drawer and books nothing;
// the keyboard, the focus inside the booking drawer. Each check works on days of its own, in 2040 to
// 2042, a range no other spec uses, in a stretch of five weeks of its browser's own, and removes what
// it wrote. The visits are written as the migration role, as appointment-move.spec.ts writes them.
// Names are the seed's invented ones; the assertions on the database name ids and times only.

const t = messages.calendar.booking;
const app = messages.calendar.appointment;
const warn = t.warning;

const DENTIST = SEEDED_PROVIDERS.harbourStreetDentist; // Dr. Planinska, lunch 12:00-13:00
const HYGIENIST = SEEDED_PROVIDERS.harbourStreetHygienist; // M. Lumi
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const BROWSERS = ['chromium', 'firefox', 'webkit'];
const CHECKS = [
  'field',
  'says',
  'held',
  'crossing',
  'failed',
  'blank',
  'inactive',
  'next',
  'double',
  'keys',
] as const;
type Check = (typeof CHECKS)[number];

/**
 * The days a check of a browser works on: five weeks of its own from Monday 2 January 2040 (a check
 * and a browser a stretch), `main` a Tuesday, `other` a Thursday, `far` a Friday, then the weekend,
 * which the clinic has no hours on; `ahead` is four weeks after `main`, `aheadOther` after `other`;
 * `past` a Tuesday of March 2020, one for each browser.
 */
function daysOf(testInfo: TestInfo, check: Check) {
  const browser = BROWSERS.indexOf(testInfo.project.name);
  if (browser < 0) throw new Error(`No days for the browser ${testInfo.project.name}.`);
  const monday = Date.UTC(2040, 0, 2) + (CHECKS.indexOf(check) * 3 + browser) * 5 * WEEK_MS;
  const at = (n: number) => new Date(monday + n * DAY_MS).toISOString().slice(0, 10);
  return {
    main: at(1),
    other: at(3),
    far: at(4),
    saturday: at(5),
    ahead: at(1 + 28),
    aheadOther: at(3 + 28),
    past: `2020-03-${String(3 + browser * 7).padStart(2, '0')}`,
  };
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
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => 30),
            $5, 'staff', $6,
            case when $5 = 'confirmed' then now() end, case when $5 = 'confirmed' then 'staff' end
       from patients p
      where p.clinic_id = $1 and p.first_name = $7 and p.last_name = $8
     returning id`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      start,
      options.provider ?? DENTIST,
      state,
      SEEDED_PEOPLE.frontDesk.id,
      first,
      last,
    ],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error(`The seed has no one ${first} ${last}.`);
  return rows[0].id;
}

/** Removes what a check wrote on these days (and its audit rows go with the clinic's own cleanup). */
async function clear(...days: string[]): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = any($2::date[])`,
    [SEEDED_CLINICS.harbourStreet, days],
  );
}

interface Stored {
  id: string;
  patient: string;
  provider: string;
  /** The local start: `HH:MM` in the clinic's zone. */
  starts: string;
  minutes: number;
  overlapOk: boolean;
}

/** The first clinic's appointments that start on the day (in the clinic's zone). */
async function rowsOn(day: string): Promise<Stored[]> {
  const { rows } = await db.query<Stored>(
    `select a.id, p.first_name || ' ' || p.last_name as patient, a.provider_id as provider,
            to_char(a.starts_at at time zone 'Europe/Skopje', 'HH24:MI') as starts,
            (extract(epoch from a.ends_at - a.starts_at) / 60)::int as minutes,
            a.overlap_ok as "overlapOk"
       from appointments a join patients p on p.id = a.patient_id
      where a.clinic_id = $1 and (a.starts_at at time zone 'Europe/Skopje')::date = $2::date
      order by a.starts_at`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
  return rows;
}

async function createdRows(id: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'appointment.created' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return Number(rows[0]?.n);
}

/** New appointment, in the calendar's header. */
const newAppointment = (page: Page) => page.getByRole('button', { name: t.open, exact: true });

/** The open booking drawer, named by its title. */
const drawer = (page: Page) => page.getByRole('dialog', { name: t.title });

const dayField = (open: Locator) => open.getByLabel(t.day, { exact: true });
const startField = (open: Locator) => open.getByLabel(t.start, { exact: true });
const providerField = (open: Locator) => open.getByLabel(t.provider, { exact: true });
const patientField = (open: Locator) => open.getByRole('combobox', { name: t.patient });
const bookButton = (open: Locator, name: RegExp | string = /^Book (?!anyway)/) =>
  open.getByRole('button', { name });
const bookAnywayButton = (open: Locator) => open.getByRole('button', { name: /^Book anyway/ });
const anywayField = (open: Locator) => open.locator('input[name="anyway"]');

/** The toasts, in their region: Radix's own copy for screen readers lasts a second only. */
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications (F8)' });

/** The visit's block on the grid, a button, by the patient's name. */
const block = (page: Page, name = 'Mimoza Kodra') =>
  page.locator('button[data-appointment]').filter({ hasText: name });

/** The appointment drawer, named by the patient. */
const appointmentDrawer = (page: Page, name = 'Mimoza Kodra') => page.getByRole('dialog', { name });

/** A message with its `{placeholders}` filled. */
function say(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

const overlapLine = (name: string, from: string, to: string) =>
  say(warn.overlap, { name, from, to });
const weekdayLine = (weekday: string) => say(warn.noHours, { weekday });

/** A date as the drawer names it: a date, in UTC, with its year (not the clinic's current year). */
function dateText(day: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(day));
}

/**
 * Opens the calendar on `day` and waits until React has hydrated New appointment (it holds React's
 * props) and the page has settled: a click before would open nothing.
 */
async function openCalendar(page: Page, day: string): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const button = newAppointment(page);
  await expect
    .poll(
      () =>
        button.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the calendar' },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

/** Opens New appointment and lets its half second pass: a press sooner is a double click's second. */
async function openBooking(page: Page): Promise<Locator> {
  await newAppointment(page).click();
  const open = drawer(page);
  await expect(open).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return open;
}

/** Picks a patient from the search by the words typed. */
async function pick(open: Locator, typed: string, name: string): Promise<void> {
  await patientField(open).fill(typed);
  await open
    .getByRole('listbox', { name: t.suggestions })
    .getByRole('option')
    .filter({ hasText: name })
    .click();
  await expect(patientField(open)).toHaveValue(name);
}

/** Closes the booking's toast with Escape and waits until none shows, before a drawer opens again. */
async function closeToast(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(toasts(page).getByRole('listitem')).toHaveCount(0);
}

/** True for the read of a day: a server action that names the day and carries no booking. */
function readsOf(request: Request, day: string): boolean {
  const body = request.postData() ?? '';
  return (
    request.method() === 'POST' &&
    request.headers()['next-action'] !== undefined &&
    body.includes(day) &&
    !body.includes('providerId')
  );
}

/** True for the request of a booking: a server action that carries a patient and a provider. */
function isBooking(request: Request): boolean {
  const body = request.postData() ?? '';
  return (
    request.method() === 'POST' &&
    request.headers()['next-action'] !== undefined &&
    body.includes('patientId') &&
    body.includes('providerId')
  );
}

test.describe('the Day field (acceptance 1)', () => {
  test('starts on the calendar’s day; a day weeks ahead and a day long past are booked, the toast names the day, the calendar keeps its own', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, ahead, past } = daysOf(testInfo, 'field');
    try {
      await openCalendar(page, main);
      let open = await openBooking(page);
      await expect(dayField(open)).toHaveValue(main);
      await expect(dayField(open)).toHaveAttribute('type', 'date');
      await pick(open, 'Mimoza K', 'Mimoza Kodra');
      await open.getByRole('button', { name: 'Filling', exact: true }).click();

      await dayField(open).fill(ahead);
      await expect(open, 'the line under the title names the day typed').toContainText(
        dateText(ahead),
      );
      await bookButton(open, 'Book 08:00 with Dr. Planinska').click();
      await expect(open).toBeHidden();
      await expect(
        toasts(page).getByText(`Booked Mimoza Kodra on ${dateText(ahead)}, 08:00.`),
      ).toBeVisible();
      const [booked] = await rowsOn(ahead);
      expect(booked).toMatchObject({
        patient: 'Mimoza Kodra',
        provider: DENTIST,
        starts: '08:00',
        minutes: 45,
      });
      expect(await rowsOn(main), 'nothing on the calendar’s day').toEqual([]);
      // The calendar shows its own day still, with the provider's column on.
      expect(page.url()).toContain(`day=${main}`);
      await expect(page.getByRole('list', { name: 'Elena Planinska' })).toBeVisible();

      // A day already past books too.
      await closeToast(page);
      open = await openBooking(page);
      await pick(open, 'Mimoza K', 'Mimoza Kodra');
      await open.getByRole('button', { name: 'Filling', exact: true }).click();
      await dayField(open).fill(past);
      await bookButton(open, 'Book 08:00 with Dr. Planinska').click();
      await expect(open).toBeHidden();
      await expect(
        toasts(page).getByText(`Booked Mimoza Kodra on ${dateText(past)}, 08:00.`),
      ).toBeVisible();
      expect(await rowsOn(past)).toHaveLength(1);
    } finally {
      await clear(main, ahead, past);
    }
  });
});

test.describe('the day typed decides what the drawer says (acceptance 2)', () => {
  test('a closed day, an overlap and Book anyway, and back: the box, the button and the `anyway` follow the day, the time held stays', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other, saturday } = daysOf(testInfo, 'says');
    try {
      await visit(other, '10:00', { patient: ['Ana', 'Brezovska'] });
      await openCalendar(page, main);
      const open = await openBooking(page);
      await startField(open).selectOption('10:00');
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await expect(anywayField(open)).toHaveCount(0);

      // A day with an overlap: its box, Book anyway, and `anyway` sent.
      await dayField(open).fill(other);
      await expect(open.getByText(overlapLine('Ana Brezovska', '10:00', '10:30'))).toBeVisible();
      await expect(bookAnywayButton(open)).toBeVisible();
      await expect(anywayField(open)).toHaveCount(1);
      await expect(startField(open), 'the time held stays chosen').toHaveValue('10:00');

      // A Saturday: the closed line, and Book as it is.
      await dayField(open).fill(saturday);
      await expect(open.getByText(weekdayLine('Saturday'))).toBeVisible();
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await expect(bookButton(open)).toBeVisible();
      await expect(anywayField(open)).toHaveCount(0);
      await expect(startField(open)).toHaveValue('10:00');

      // Back on the calendar's day: nothing, Book, no `anyway`.
      await dayField(open).fill(main);
      await expect(open.getByText(weekdayLine('Saturday'))).toHaveCount(0);
      await expect(bookButton(open)).toBeVisible();
      await expect(anywayField(open)).toHaveCount(0);
      await expect(open, 'the line under the title follows').toContainText(dateText(main));
    } finally {
      await clear(main, other, saturday);
    }
  });
});

test.describe('a changed day’s read (acceptance 3)', () => {
  test('held: the old box stays, Book is Book and sends no `anyway` until the answer; then the box and the button follow', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other, far } = daysOf(testInfo, 'held');
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route(`${APP}/calendar**`, async (route) => {
      if (!readsOf(route.request(), far)) return route.fallback();
      held++;
      await released;
      return route.continue();
    });
    const bookings: string[] = [];
    page.on('request', (request) => {
      if (isBooking(request)) bookings.push(request.postData() ?? '');
    });
    try {
      await visit(other, '10:00', { patient: ['Ana', 'Brezovska'] });
      await visit(far, '10:00', { patient: ['Elena', 'Kodra'] });
      await openCalendar(page, main);
      const open = await openBooking(page);
      await startField(open).selectOption('10:00');
      await dayField(open).fill(other);
      const otherLine = open.getByText(overlapLine('Ana Brezovska', '10:00', '10:30'));
      const farLine = open.getByText(overlapLine('Elena Kodra', '10:00', '10:30'));
      await expect(otherLine).toBeVisible();
      await expect(bookAnywayButton(open)).toBeVisible();

      // The day changes to one with an overlap of its own, whose read is held.
      await dayField(open).fill(far);
      await expect.poll(() => held, { message: 'the far day’s read is sent, and held' }).toBe(1);
      await expect(otherLine, 'the old box stays').toBeVisible();
      await expect(bookButton(open)).toBeVisible();
      await expect(bookAnywayButton(open)).toHaveCount(0);
      await expect(anywayField(open)).toHaveCount(0);
      expect(bookings, 'nothing was booked').toEqual([]);

      release();
      await expect(farLine, 'the far day’s own box comes').toBeVisible();
      await expect(otherLine).toHaveCount(0);
      await expect(bookAnywayButton(open)).toBeVisible();
      await expect(anywayField(open)).toHaveCount(1);
    } finally {
      release();
      await clear(main, other, far);
    }
  });

  test('two reads that cross: only the last answer counts', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other, far } = daysOf(testInfo, 'crossing');
    const holds = new Map<string, { release: () => void; released: Promise<void>; seen: number }>();
    for (const day of [other, far]) {
      const hold = { release: () => {}, released: Promise.resolve(), seen: 0 };
      hold.released = new Promise<void>((resolve) => {
        hold.release = resolve;
      });
      holds.set(day, hold);
    }
    await page.route(`${APP}/calendar**`, async (route) => {
      for (const [day, hold] of holds) {
        if (!readsOf(route.request(), day)) continue;
        hold.seen++;
        await hold.released;
        return route.continue();
      }
      return route.fallback();
    });
    const seen = (day: string) => holds.get(day)?.seen ?? 0;
    try {
      await visit(far, '10:00', { patient: ['Elena', 'Kodra'] });
      await openCalendar(page, main);
      const open = await openBooking(page);
      await startField(open).selectOption('10:00');
      const farLine = open.getByText(overlapLine('Elena Kodra', '10:00', '10:30'));

      // The far day is typed, then another day, before the far day answers. Next.js sends one server
      // action at a time: the other day's read waits behind the far day's, which is held.
      await dayField(open).fill(far);
      await expect.poll(() => seen(far)).toBe(1);
      await dayField(open).fill(other);
      await page.waitForTimeout(300);
      expect(seen(other), 'the other day’s read waits in the queue').toBe(0);
      // The far day's answer comes late, after the form points at the other day: it is dropped. Its
      // read is over when the other day's is sent; that one is held, so the box is still the first day's.
      holds.get(far)?.release();
      await expect.poll(() => seen(other)).toBe(1);
      await page.waitForTimeout(300);
      await expect(farLine, 'the late answer is dropped').toHaveCount(0);
      await expect(bookButton(open)).toBeVisible();
      await expect(anywayField(open)).toHaveCount(0);
      holds.get(other)?.release();
      await page.waitForTimeout(300);
      await expect(farLine).toHaveCount(0);
      await expect(bookButton(open)).toBeVisible();
      await expect(anywayField(open)).toHaveCount(0);
    } finally {
      for (const hold of holds.values()) hold.release();
      await clear(main, other, far);
    }
  });

  test('a read that does not work empties the box and says so; Book still checks: the overlap is refused and nothing is written', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other, far } = daysOf(testInfo, 'failed');
    await page.route(`${APP}/calendar**`, async (route) => {
      if (readsOf(route.request(), far)) return route.abort();
      return route.fallback();
    });
    try {
      await visit(far, '10:00', { patient: ['Elena', 'Kodra'] });
      await openCalendar(page, main);
      const open = await openBooking(page);
      await pick(open, 'Mimoza K', 'Mimoza Kodra');
      await open.getByRole('button', { name: 'Filling', exact: true }).click();
      await startField(open).selectOption('10:00');

      await dayField(open).fill(far);
      await expect(open.getByText(t.couldNotCheck)).toBeVisible();
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await expect(anywayField(open)).toHaveCount(0);
      await expect(bookButton(open)).toBeVisible();

      // The next complete date is read, and the line goes.
      await dayField(open).fill(other);
      await expect(open.getByText(t.couldNotCheck)).toHaveCount(0);

      // Back on the failed day, Book is the server's: it refuses the overlap.
      await dayField(open).fill(far);
      await expect(open.getByText(t.couldNotCheck)).toBeVisible();
      await bookButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(t.overlap);
      expect(await rowsOn(far)).toHaveLength(1);
      await expect(open).toBeVisible();
    } finally {
      await clear(main, other, far);
    }
  });
});

test.describe('a blank or half-typed day (acceptance 4)', () => {
  test('Book is refused at the Day field and writes nothing; the line under the title still names the last complete day', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, ahead } = daysOf(testInfo, 'blank');
    try {
      await openCalendar(page, main);
      const open = await openBooking(page);
      await pick(open, 'Mimoza K', 'Mimoza Kodra');
      await open.getByRole('button', { name: 'Filling', exact: true }).click();
      await dayField(open).fill(ahead);
      await dayField(open).fill('');
      await expect(open, 'the line still names the last complete day').toContainText(
        dateText(ahead),
      );
      await bookButton(open).click();
      await expect(dayField(open)).toHaveAttribute('aria-invalid', 'true');
      await expect(open.getByText(messages.form.fieldErrors.missing)).toBeVisible();
      expect(await rowsOn(main)).toEqual([]);
      expect(await rowsOn(ahead)).toEqual([]);
      await expect(open).toBeVisible();

      // A day typed again books.
      await dayField(open).fill(ahead);
      await bookButton(open).click();
      await expect(open).toBeHidden();
      expect(await rowsOn(ahead)).toHaveLength(1);
    } finally {
      await clear(main, ahead);
    }
  });
});

test.describe('a provider made inactive between two reads (acceptance 2)', () => {
  test.use({ storageState: OWNER_SESSION });

  // The second seeded clinic, on a provider of the check's own (sort_order 100, after the seed's), so
  // no other spec's column or choice changes, even for a moment.
  const SONCOGLED = SEEDED_CLINICS.soncogled;
  const SONCOGLED_NAME = 'Забна клиника Сончоглед';

  test('a provider chosen on the first day and inactive on the second is replaced by the first active one', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, other } = daysOf(testInfo, 'inactive');
    const providerName = `Day ${testInfo.project.name} Mira Testova`;
    const removeOwn = () =>
      db.query(`delete from providers where clinic_id = $1 and name = $2`, [
        SONCOGLED,
        providerName,
      ]);
    await removeOwn();
    try {
      const { rows: made } = await db.query<{ id: string }>(
        `insert into providers (id, clinic_id, name, short_name, kind, chair_label, color_hue, sort_order)
         values (gen_random_uuid(), $1, $2, $3, 'dentist', 'Chair 8', 40, 100) returning id`,
        [SONCOGLED, providerName, `D-${testInfo.project.name.slice(0, 3)}`],
      );
      const providerId = made[0]?.id;
      if (!providerId) throw new Error('The provider was not written.');

      await page.goto(`${APP}/choose-clinic`);
      await page.getByRole('button', { name: SONCOGLED_NAME }).click();
      await expect(page).toHaveURL(`${APP}/`);
      await openCalendar(page, main);
      const open = await openBooking(page);
      await providerField(open).selectOption(providerId);
      await expect(providerField(open)).toHaveValue(providerId);

      // Another desk makes the provider inactive; this page does not know until it reads another day.
      await db.query(`update providers set active = false where id = $1`, [providerId]);
      await dayField(open).fill(other);
      await expect(providerField(open).locator(`option[value="${providerId}"]`)).toHaveCount(0);
      await expect(providerField(open), 'the first active provider is chosen').not.toHaveValue(
        providerId,
      );
      await expect(providerField(open)).not.toHaveValue('');
    } finally {
      await removeOwn();
    }
  });
});

test.describe('Book next visit (acceptance 5)', () => {
  test('from a booked, a completed and a cancelled visit: the drawer opens on the patient, the visit’s provider, the calendar’s day, no treatment; typing replaces the patient; one booking, weeks ahead', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main, ahead } = daysOf(testInfo, 'next');
    try {
      await visit(main, '09:00', { patient: ['Mimoza', 'Kodra'], provider: HYGIENIST });
      await visit(main, '10:00', { patient: ['Ana', 'Brezovska'], status: 'completed' });
      await visit(main, '11:00', { patient: ['Elena', 'Kodra'], status: 'cancelled' });
      await openCalendar(page, main);

      for (const name of ['Ana Brezovska', 'Elena Kodra', 'Mimoza Kodra']) {
        await block(page, name).click();
        const visitDrawer = appointmentDrawer(page, name);
        await expect(visitDrawer).toBeVisible();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
        const next = visitDrawer.getByRole('button', { name: app.bookNext, exact: true });
        await expect(next, `the button on ${name}'s visit`).toBeVisible();
        if (name !== 'Mimoza Kodra') {
          await page.keyboard.press('Escape');
          await expect(visitDrawer).toBeHidden();
          await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
          continue;
        }
        await next.click();
        const open = drawer(page);
        await expect(open).toBeVisible();
        await expect(visitDrawer, 'the appointment drawer is gone').toBeHidden();
        await expect(patientField(open)).toHaveValue('Mimoza Kodra');
        await expect(providerField(open), 'the visit’s provider').toHaveValue(HYGIENIST);
        await expect(dayField(open), 'the calendar’s day').toHaveValue(main);
        await expect(open.getByRole('button', { pressed: true })).toHaveCount(0);
        await expect(open.locator('input[name="patientId"]')).not.toHaveValue('');
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);

        // Typing in the patient field replaces the patient.
        await patientField(open).press('Backspace');
        await expect(open.locator('input[name="patientId"]')).toHaveValue('');
        await pick(open, 'Mimoza K', 'Mimoza Kodra');

        // A treatment and a day weeks ahead: one booking, with that provider, on that day.
        await open.getByRole('button', { name: 'Filling', exact: true }).click();
        await dayField(open).fill(ahead);
        await bookButton(open).click();
        await expect(open).toBeHidden();
      }
      const rows = await rowsOn(ahead);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ patient: 'Mimoza Kodra', provider: HYGIENIST, minutes: 45 });
      expect(await createdRows(rows[0]?.id ?? '')).toBe(1);
      expect(await rowsOn(main), 'the three visits only').toHaveLength(3);
    } finally {
      await clear(main, ahead);
    }
  });
});

test.describe('the press of a double click, and the keyboard (acceptance 6)', () => {
  test('a double click on Book next visit leaves one booking drawer open and books nothing', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'double');
    try {
      await visit(main, '09:00');
      await openCalendar(page, main);
      await block(page).click();
      const visitDrawer = appointmentDrawer(page);
      await expect(visitDrawer).toBeVisible();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      const bookings: string[] = [];
      page.on('request', (request) => {
        if (isBooking(request)) bookings.push(request.postData() ?? '');
      });

      await visitDrawer.getByRole('button', { name: app.bookNext, exact: true }).dblclick();
      await expect(drawer(page)).toBeVisible();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 300);
      await expect(page.getByRole('dialog'), 'exactly one drawer').toHaveCount(1);
      await expect(drawer(page)).toBeVisible();
      expect(bookings, 'nothing was booked').toEqual([]);
      expect(await rowsOn(main), 'the one visit only').toHaveLength(1);
    } finally {
      await clear(main);
    }
  });

  test('by keyboard: Tab to the button, Enter, the focus is inside the booking drawer; Escape closes it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { main } = daysOf(testInfo, 'keys');
    try {
      await visit(main, '09:00');
      await openCalendar(page, main);
      await block(page).focus();
      await page.keyboard.press('Enter');
      const visitDrawer = appointmentDrawer(page);
      await expect(visitDrawer).toBeVisible();

      const next = visitDrawer.getByRole('button', { name: app.bookNext, exact: true });
      // The focus is in the drawer (Radix puts it there as it opens) before the first Tab.
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null))
        .toBe(true);
      const visited: string[] = [];
      for (let tab = 0; tab < 20; tab++) {
        await page.keyboard.press('Tab');
        visited.push(
          await page.evaluate(() => {
            const active = document.activeElement;
            return `${active?.tagName} ${active?.textContent?.slice(0, 30) ?? ''}`;
          }),
        );
        if (await next.evaluate((node) => node === document.activeElement)) break;
      }
      await expect(next, `Tab reached it: ${visited.join(' | ')}`).toBeFocused();
      await page.keyboard.press('Enter');
      const open = drawer(page);
      await expect(open).toBeVisible();
      await expect(visitDrawer).toBeHidden();
      await expect(open.locator(':focus'), 'the focus is inside the booking drawer').toHaveCount(1);
      await expect(patientField(open)).toHaveValue('Mimoza Kodra');

      await page.keyboard.press('Escape');
      await expect(open).toBeHidden();
    } finally {
      await clear(main);
    }
  });
});
