import { expect, test, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T06f, the tester's checks (the builder's are appointment-move.spec.ts): the move form where the
// clinic's clock and the calendar's day part ways. A visit across midnight seen from the day after (its
// form starts on the day before and reads it); the two nights the clocks change (a start the clocks
// skip is refused with its text, the repeated hour moves); a closed day (a row of `closed_days`, not a
// weekend) warns and still moves; a visit cancelled by another desk while the form is open. Days are of
// the browser's own and in 2034 to 2036, which no other spec uses; each check removes what it wrote.

const move = messages.calendar.appointment.move;
const warn = messages.calendar.booking.warning;
const DENTIST = SEEDED_PROVIDERS.harbourStreetDentist;
const DAY_MS = 24 * 60 * 60 * 1000;
const BROWSERS = ['chromium', 'firefox', 'webkit'];

/** A week of the browser's own for each check, from Monday 2 January 2034. */
function weekOf(testInfo: TestInfo, check: number) {
  const browser = BROWSERS.indexOf(testInfo.project.name);
  if (browser < 0) throw new Error(`No days for the browser ${testInfo.project.name}.`);
  const monday = Date.UTC(2034, 0, 2) + (check * 3 + browser) * 7 * DAY_MS;
  const at = (n: number) => new Date(monday + n * DAY_MS).toISOString().slice(0, 10);
  return { tuesday: at(1), wednesday: at(2), thursday: at(3), friday: at(4) };
}

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

/** A visit as the migration role writes it, from a local start (any date-time text) for `minutes`. */
async function visit(local: string, minutes = 30): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     select gen_random_uuid(), p.clinic_id, p.id, $2, 'Checkup',
            $3::timestamp at time zone 'Europe/Skopje',
            ($3::timestamp at time zone 'Europe/Skopje') + make_interval(mins => $4),
            'booked', 'staff', $5
       from patients p
      where p.clinic_id = $1 and p.first_name = 'Mimoza' and p.last_name = 'Kodra'
     returning id`,
    [SEEDED_CLINICS.harbourStreet, DENTIST, local, minutes, SEEDED_PEOPLE.frontDesk.id],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error('The seed has no Mimoza Kodra.');
  return rows[0].id;
}

async function clear(...days: string[]): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = any($2::date[])`,
    [SEEDED_CLINICS.harbourStreet, days],
  );
}

interface Stored {
  at: string;
  minutes: number;
  status: string;
}
async function stored(id: string): Promise<Stored | undefined> {
  const { rows } = await db.query<Stored>(
    `select to_char(starts_at at time zone 'Europe/Skopje', 'YYYY-MM-DD HH24:MI') as at,
            (extract(epoch from ends_at - starts_at) / 60)::int as minutes, status
       from appointments where id = $1`,
    [id],
  );
  return rows[0];
}
async function movedRows(id: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log where action = 'appointment.moved' and entity_id = $1`,
    [id],
  );
  return Number(rows[0]?.n);
}

const block = (page: Page) =>
  page.locator('button[data-appointment]').filter({ hasText: 'Mimoza' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Mimoza Kodra' });

async function openDrawer(page: Page, day: string) {
  await page.goto(`${APP}/calendar?day=${day}`);
  const button = block(page).first();
  await expect(button).toBeVisible();
  await expect
    .poll(() =>
      button.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
  await button.click();
  const open = drawer(page);
  await expect(open).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return open;
}

const dayField = (open: ReturnType<typeof drawer>) => open.getByLabel(move.day, { exact: true });
const timeField = (open: ReturnType<typeof drawer>) => open.getByLabel(move.start, { exact: true });
const moveButton = (open: ReturnType<typeof drawer>) =>
  open.getByRole('button', { name: move.submit, exact: true });

test.describe('the move form where the clocks and the calendar part ways', () => {
  test('a visit across midnight, seen from the day after: the form starts on the day it starts, with its time and length', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { tuesday, wednesday } = weekOf(testInfo, 0);
    try {
      // 23:45 to 00:45: on Wednesday's grid from 00:00 to 00:45, started on Tuesday.
      const id = await visit(`${tuesday} 23:45`, 60);
      const open = await openDrawer(page, wednesday);
      await expect(dayField(open)).toHaveValue(tuesday);
      await expect(timeField(open)).toHaveValue('23:45');
      // The form reads Tuesday: its closing hours warn, the visit's own old place does not.
      await expect(open.getByText(/Runs outside the opening hours/)).toBeVisible();
      await expect(open.getByText('Overlaps')).toHaveCount(0);
      await expect(moveButton(open)).toBeVisible();

      // Nothing changed is refused: the form does not take the shown day for the visit's.
      await moveButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(move.refusals.nothingChanged);
      expect(await movedRows(id)).toBe(0);

      // Moved to 14:00 on Tuesday: the length stays an hour, and the visit leaves Wednesday.
      await timeField(open).selectOption('14:00');
      await moveButton(open).click();
      await expect(open).toBeHidden();
      await expect(block(page)).toHaveCount(0);
      expect(await stored(id)).toEqual({ at: `${tuesday} 14:00`, minutes: 60, status: 'booked' });
      expect(await movedRows(id)).toBe(1);
    } finally {
      await clear(tuesday, wednesday);
    }
  });

  test('a closed day (a row of closed days) warns with its reason, leaves Move as it is, and the visit moves there', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { tuesday, thursday } = weekOf(testInfo, 1);
    const label = `Tester holiday ${testInfo.project.name}`;
    const ownRow = async () =>
      db.query(`delete from closed_days where clinic_id = $1 and date = $2`, [
        SEEDED_CLINICS.harbourStreet,
        thursday,
      ]);
    await ownRow();
    try {
      await db.query(
        `insert into closed_days (id, clinic_id, date, label)
         values (gen_random_uuid(), $1, $2, $3)`,
        [SEEDED_CLINICS.harbourStreet, thursday, label],
      );
      const id = await visit(`${tuesday} 09:00`);
      const open = await openDrawer(page, tuesday);
      await dayField(open).fill(thursday);
      await expect(open.getByText(warn.closedDay.replace('{label}', label))).toBeVisible();
      await expect(moveButton(open)).toBeVisible();
      await expect(open.locator('input[name="anyway"]')).toHaveCount(0);
      await moveButton(open).click();
      await expect(open).toBeHidden();
      expect(await stored(id)).toEqual({ at: `${thursday} 09:00`, minutes: 30, status: 'booked' });
      expect(await movedRows(id)).toBe(1);
    } finally {
      await clear(tuesday, thursday);
      await ownRow();
    }
  });

  test('the night the clocks go forward: the skipped start is refused with its text and writes nothing; another start moves. The night they go back: the repeated hour moves', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    // The last Sunday of March and of October, in a year of the browser's own (2034, 2035, 2036).
    const browser = BROWSERS.indexOf(testInfo.project.name);
    const forward = [
      ['2034-03-25', '2034-03-26'],
      ['2035-03-24', '2035-03-25'],
      ['2036-03-29', '2036-03-30'],
    ][browser];
    const back = [
      ['2034-10-28', '2034-10-29'],
      ['2035-10-27', '2035-10-28'],
      ['2036-10-25', '2036-10-26'],
    ][browser];
    if (!forward || !back) throw new Error('No clock-change days for this browser.');
    const [saturday, sunday] = forward;
    const [autumnSaturday, autumnSunday] = back;
    if (!saturday || !sunday || !autumnSaturday || !autumnSunday) throw new Error('No days.');
    try {
      const id = await visit(`${saturday} 02:30`);
      const open = await openDrawer(page, saturday);
      await expect(timeField(open)).toHaveValue('02:30');
      await dayField(open).fill(sunday);
      await expect(timeField(open), 'the time is not moved under the person').toHaveValue('02:30');
      await moveButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(move.refusals.startSkipped);
      expect(await stored(id)).toEqual({ at: `${saturday} 02:30`, minutes: 30, status: 'booked' });
      expect(await movedRows(id)).toBe(0);
      await expect(open).toBeVisible();

      await timeField(open).selectOption('09:00');
      await moveButton(open).click();
      await expect(open).toBeHidden();
      expect(await stored(id)).toEqual({ at: `${sunday} 09:00`, minutes: 30, status: 'booked' });
      expect(await movedRows(id)).toBe(1);

      // The autumn night: 02:30 comes twice; the move keeps one of them and the length.
      const autumn = await visit(`${autumnSaturday} 02:30`);
      const second = await openDrawer(page, autumnSaturday);
      await dayField(second).fill(autumnSunday);
      await moveButton(second).click();
      await expect(second).toBeHidden();
      expect(await stored(autumn)).toEqual({
        at: `${autumnSunday} 02:30`,
        minutes: 30,
        status: 'booked',
      });
      expect(await movedRows(autumn)).toBe(1);
    } finally {
      await clear(saturday ?? '', sunday ?? '', autumnSaturday ?? '', autumnSunday ?? '');
    }
  });

  test('another desk cancels the visit while the form is open: Move is refused above the button and writes nothing', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { tuesday } = weekOf(testInfo, 2);
    try {
      const id = await visit(`${tuesday} 09:00`);
      const open = await openDrawer(page, tuesday);
      await timeField(open).selectOption('10:00');
      await db.query(
        `update appointments set status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff'
          where id = $1`,
        [id],
      );
      await moveButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(move.refusals.notMovable);
      expect(await stored(id)).toEqual({
        at: `${tuesday} 09:00`,
        minutes: 30,
        status: 'cancelled',
      });
      expect(await movedRows(id)).toBe(0);
    } finally {
      await clear(tuesday);
    }
  });
});
