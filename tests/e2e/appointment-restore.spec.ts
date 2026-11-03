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

// E01-T06g in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): Restore in the appointment drawer. Which visits have it; a restore
// over a free place and over a visit that holds the chair (the box, Restore anyway, the hidden field in
// the request's body and the row the database keeps); a break and the hours never in the box; the
// refusals above the button (an overlap another desk made after the box was drawn, the same visit
// booked again, the patient archived, the visit restored by another desk, the provider made inactive);
// a double click on Restore; Escape and the overlay while a restore is on its way; the keyboard, where
// the focus goes, and the accessibility check with Restore anyway and its box showing. Each check works
// on days of its own in a week of its browser's own, in 2038, a year no other spec uses, and removes
// what it wrote. The visits are written as the migration role, as appointment-move.spec.ts writes its
// rows. A provider made inactive meanwhile is tried in the second seeded clinic, as the seeded owner,
// on a provider the check writes itself and removes (the first clinic's providers are the columns the
// other specs count, as provider-edit.spec.ts says). A patient archived meanwhile is one the check
// adds itself and removes. Names are the seed's invented ones; the assertions on the database name
// ids and statuses only.

const t = messages.calendar.appointment;
const restore = t.restore;
const warn = messages.calendar.booking.warning;
const status = messages.appointmentStatus;

const DENTIST = SEEDED_PROVIDERS.harbourStreetDentist; // Dr. Planinska, lunch 12:00-13:00
const HYGIENIST = SEEDED_PROVIDERS.harbourStreetHygienist; // M. Lumi
const DAY_MS = 24 * 60 * 60 * 1000;

const BROWSERS = ['chromium', 'firefox', 'webkit'];
const CHECKS = [
  'shape',
  'free',
  'overlap',
  'refusals',
  'archived',
  'double',
  'busy',
  'keys',
  'inactive',
] as const;
type Check = (typeof CHECKS)[number];

/**
 * The days a check of a browser works on: a week of its own (the checks and browsers take turns from
 * Monday 4 January 2038), `main` a Tuesday. No other spec uses 2038.
 */
function dayOf(testInfo: TestInfo, check: Check): string {
  const browser = BROWSERS.indexOf(testInfo.project.name);
  if (browser < 0) throw new Error(`No day for the browser ${testInfo.project.name}.`);
  const monday = Date.UTC(2038, 0, 4) + (CHECKS.indexOf(check) * 3 + browser) * 7 * DAY_MS;
  return new Date(monday + DAY_MS).toISOString().slice(0, 10);
}

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

/**
 * A visit as the migration role writes it: the patient of that name, a provider, a local start. A
 * cancelled one has its cancel columns, and `confirmed` gives it the confirmation it had before.
 */
async function visit(
  day: string,
  start: string,
  options: {
    patient?: [string, string];
    provider?: string;
    minutes?: number;
    status?: string;
    confirmed?: boolean;
  } = {},
): Promise<string> {
  const [first, last] = options.patient ?? ['Mimoza', 'Kodra'];
  const state = options.status ?? 'booked';
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by, confirmed_at, confirmed_via,
                               cancelled_at, cancelled_by, cancel_reason)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + $3::time) at time zone 'Europe/Skopje',
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => $5),
            $6, 'staff', $7,
            case when $6 = 'confirmed' or $10::boolean then now() end,
            case when $6 = 'confirmed' or $10::boolean then 'staff' end,
            case when $6 = 'cancelled' then now() end,
            case when $6 = 'cancelled' then 'patient' end,
            case when $6 = 'cancelled' then 'Phoned to cancel' end
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
      options.confirmed ?? false,
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
  status: string;
  cancelledAt: boolean;
  cancelledBy: string | null;
  cancelReason: string | null;
  confirmedAt: boolean;
  confirmedVia: string | null;
  overlapOk: boolean;
}

async function stored(id: string): Promise<Stored | undefined> {
  const { rows } = await db.query<Stored>(
    `select status, cancelled_at is not null as "cancelledAt", cancelled_by as "cancelledBy",
            cancel_reason as "cancelReason", confirmed_at is not null as "confirmedAt",
            confirmed_via as "confirmedVia", overlap_ok as "overlapOk"
       from appointments where id = $1`,
    [id],
  );
  return rows[0];
}

/** The `appointment.status_changed` rows of the visit: their statuses (ids and codes only). */
async function statusRows(id: string): Promise<{ fromStatus: string; toStatus: string }[]> {
  const { rows } = await db.query<{ fromStatus: string; toStatus: string }>(
    `select metadata->>'fromStatus' as "fromStatus", metadata->>'toStatus' as "toStatus"
       from audit_log
      where clinic_id = $1 and action = 'appointment.status_changed' and entity_id = $2
      order by at`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return rows;
}

/** The visit's block on the grid, a button, by the patient's name. */
const block = (page: Page, name = 'Mimoza Kodra') =>
  page.locator('button[data-appointment]').filter({ hasText: name });

/** The open drawer, named by the patient. */
const drawer = (page: Page, name = 'Mimoza Kodra') => page.getByRole('dialog', { name });

/** The status pill of the drawer. */
const pill = (open: Locator) => open.locator('[data-slot="badge"]');

const restoreButton = (open: Locator, name: string = restore.submit) =>
  open.getByRole('button', { name, exact: true });
const anywayField = (open: Locator) => open.locator('input[name="anyway"]');

/** A message with its `{placeholders}` filled. */
function say(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

const overlapLine = (name: string, from: string, to: string) =>
  say(warn.overlap, { name, from, to });

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

/** True for the request of a restore: a server action that carries an appointment and `restore`. */
function isRestore(request: Request): boolean {
  const body = request.postData() ?? '';
  return (
    request.method() === 'POST' &&
    request.headers()['next-action'] !== undefined &&
    body.includes('appointmentId') &&
    body.includes('restore')
  );
}

/** The bodies of the restores the page sends from now on. */
function restoresSent(page: Page): string[] {
  const bodies: string[] = [];
  page.on('request', (request) => {
    if (isRestore(request)) bodies.push(request.postData() ?? '');
  });
  return bodies;
}

test.describe('which visits have Restore (acceptance 1)', () => {
  test('a cancelled and a no-show visit show it and no "nothing to change" line; a booked, confirmed, arrived and completed one show none', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'shape');
    try {
      await visit(main, '08:00', { patient: ['Mimoza', 'Kodra'], status: 'cancelled' });
      await visit(main, '08:30', { patient: ['Ana', 'Lumi'], status: 'no_show' });
      await visit(main, '09:00', { patient: ['Ana', 'Brezovska'] });
      await visit(main, '09:30', { patient: ['Bojan', 'Kamenov'], status: 'confirmed' });
      await visit(main, '10:00', { patient: ['Elena', 'Kodra'], status: 'arrived' });
      await visit(main, '10:30', { patient: ['Marko', 'Ezerovski'], status: 'completed' });
      await openCalendar(page, main);

      const cases: [string, boolean][] = [
        ['Mimoza Kodra', true],
        ['Ana Lumi', true],
        ['Ana Brezovska', false],
        ['Bojan Kamenov', false],
        ['Elena Kodra', false],
        ['Marko Ezerovski', false],
      ];
      for (const [name, has] of cases) {
        const open = await openDrawer(page, name);
        if (has) {
          await expect(restoreButton(open), name).toBeVisible();
          await expect(open.getByRole('heading', { name: t.update }), name).toBeVisible();
          await expect(open.getByText(t.nothingToChange), name).toHaveCount(0);
        } else {
          await expect(restoreButton(open), name).toHaveCount(0);
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

test.describe('Restore over a free place (acceptance 1)', () => {
  test('a cancelled visit that was confirmed and a no-show visit: each is booked again, its cancel columns and confirmation cleared, one audit row, no anyway sent; the pill reads Booked and the drawer stays open on the move form and the status buttons', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'free');
    try {
      const cancelled = await visit(main, '09:00', { status: 'cancelled', confirmed: true });
      const noShow = await visit(main, '10:00', { patient: ['Ana', 'Lumi'], status: 'no_show' });
      expect(await stored(cancelled)).toMatchObject({
        status: 'cancelled',
        cancelledAt: true,
        cancelledBy: 'patient',
        confirmedAt: true,
      });
      await openCalendar(page, main);
      const sent = restoresSent(page);

      const cases: [string, string, string][] = [
        ['Mimoza Kodra', cancelled, 'cancelled'],
        ['Ana Lumi', noShow, 'no_show'],
      ];
      for (const [index, [name, id, before]] of cases.entries()) {
        const open = await openDrawer(page, name);
        await expect(pill(open)).toHaveText(
          before === 'cancelled' ? status.cancelled : status.no_show,
        );
        await expect(open.getByText('Overlaps')).toHaveCount(0);
        await expect(anywayField(open)).toHaveCount(0);
        await restoreButton(open).click();

        await expect(pill(open), 'the pill reads Booked at once').toHaveText(status.booked);
        await expect(open, 'the drawer stays open').toBeVisible();
        await expect(open.getByRole('heading', { name: t.move.heading })).toBeVisible();
        await expect(open.getByRole('button', { name: t.actions.arrive.label })).toBeVisible();
        await expect(restoreButton(open), 'the restore form is gone with its button').toHaveCount(
          0,
        );
        expect(await stored(id)).toEqual({
          status: 'booked',
          cancelledAt: false,
          cancelledBy: null,
          cancelReason: null,
          confirmedAt: false,
          confirmedVia: null,
          overlapOk: false,
        });
        expect(await statusRows(id)).toEqual([{ fromStatus: before, toStatus: 'booked' }]);
        expect(sent, 'one restore more').toHaveLength(index + 1);
        expect(sent[index], 'no anyway over a free place').not.toContain('anyway');
        await closeDrawer(page, open);
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      }
    } finally {
      await clear(main);
    }
  });
});

test.describe('Restore over a visit that holds the chair (acceptance 2)', () => {
  test('the box names it, the button reads Restore anyway and sends anyway, and the restore keeps overlap_ok; a visit of another provider, a cancelled one, a break and the hours are never in the box', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'overlap');
    try {
      const id = await visit(main, '09:00', { status: 'cancelled' });
      await visit(main, '09:15', { patient: ['Ana', 'Brezovska'] });
      await visit(main, '09:00', { patient: ['Elena', 'Kodra'], provider: HYGIENIST });
      await visit(main, '09:00', { patient: ['Bojan', 'Kamenov'], status: 'cancelled' });
      // In the dentist's lunch (12:00-13:00) and outside the hours (08:00-18:00): neither is warned of.
      await visit(main, '12:00', { patient: ['Marko', 'Ezerovski'], status: 'cancelled' });
      await visit(main, '17:30', { patient: ['Ana', 'Lumi'], status: 'no_show', minutes: 60 });
      await openCalendar(page, main);
      const sent = restoresSent(page);

      // Over a break and outside the hours: the free place, Restore.
      for (const name of ['Marko Ezerovski', 'Ana Lumi']) {
        const open = await openDrawer(page, name);
        await expect(restoreButton(open), name).toBeVisible();
        await expect(open.getByText('Overlaps'), name).toHaveCount(0);
        await expect(open.getByText(/break|opening hours/), name).toHaveCount(0);
        await expect(anywayField(open), name).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(open).toBeHidden();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      }

      // Over the booked visit: it is named. Bojan's cancelled visit at the same time holds no chair, and
      // Elena's is another provider's, so there is one line.
      const open = await openDrawer(page);
      await expect(open.getByText(overlapLine('Ana Brezovska', '09:15', '09:45'))).toBeVisible();
      await expect(open.getByText('Overlaps')).toHaveCount(1);
      await expect(open.getByText(warn.restoreAnyway)).toBeVisible();
      await expect(restoreButton(open, restore.restoreAnyway)).toBeVisible();
      await expect(restoreButton(open)).toHaveCount(0);
      await expect(anywayField(open)).toHaveCount(1);

      await restoreButton(open, restore.restoreAnyway).click();
      await expect(pill(open)).toHaveText(status.booked);
      expect(sent).toHaveLength(1);
      expect(sent[0], 'anyway is in the request').toContain('anyway');
      expect(await stored(id)).toMatchObject({ status: 'booked', overlapOk: true });
      expect(await statusRows(id)).toEqual([{ fromStatus: 'cancelled', toStatus: 'booked' }]);
    } finally {
      await clear(main);
    }
  });
});

test.describe('the refusals above the button (acceptance 3)', () => {
  test('an overlap that arose after the box was drawn: refused, nothing written, the box then names it and Restore anyway restores', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'refusals');
    try {
      const id = await visit(main, '09:00', { status: 'cancelled' });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await expect(open.getByText('Overlaps')).toHaveCount(0);

      // Another desk books the place after the box was drawn.
      await visit(main, '09:15', { patient: ['Ana', 'Brezovska'] });
      await restoreButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(restore.refusals.overlap);
      expect(await stored(id)).toMatchObject({ status: 'cancelled', overlapOk: false });
      expect(await statusRows(id)).toEqual([]);

      // The refusal brought the day again: the box names the visit and the button says so.
      await expect(open.getByText(overlapLine('Ana Brezovska', '09:15', '09:45'))).toBeVisible();
      await expect(restoreButton(open, restore.restoreAnyway)).toBeVisible();
      await restoreButton(open, restore.restoreAnyway).click();
      await expect(pill(open)).toHaveText(status.booked);
      expect(await stored(id)).toMatchObject({ status: 'booked', overlapOk: true });
      expect(await statusRows(id)).toHaveLength(1);
    } finally {
      await clear(main);
    }
  });

  test('the same visit booked again: refused as already booked, with or without anyway, nothing written', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'refusals');
    try {
      const id = await visit(main, '11:00', { status: 'cancelled' });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await visit(main, '11:00'); // the same patient, provider and start, booked again
      await restoreButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(restore.refusals.alreadyBooked);
      expect(await stored(id)).toMatchObject({ status: 'cancelled' });

      // The box now shows the visit, and "anyway" does not get past it.
      await expect(restoreButton(open, restore.restoreAnyway)).toBeVisible();
      await restoreButton(open, restore.restoreAnyway).click();
      await expect(open.getByRole('alert')).toHaveText(restore.refusals.alreadyBooked);
      expect(await stored(id)).toMatchObject({ status: 'cancelled' });
      expect(await statusRows(id)).toEqual([]);
    } finally {
      await clear(main);
    }
  });

  test('the visit restored by another desk meanwhile: refused as changed meanwhile, nothing more written', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'refusals');
    try {
      const id = await visit(main, '14:00', { status: 'no_show' });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await db.query(
        `update appointments set status = 'booked' where id = $1 and status = 'no_show'`,
        [id],
      );
      await restoreButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(t.refusals.notAllowed);
      expect(await stored(id)).toMatchObject({ status: 'booked' });
      expect(await statusRows(id)).toEqual([]);
    } finally {
      await clear(main);
    }
  });
});

test.describe('a patient archived meanwhile (acceptance 3)', () => {
  test('the drawer is open on the cancelled visit, the patient is archived, Restore is pressed: the refusal shows above the button and nothing is written', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'archived');
    const last = `Archived-${testInfo.project.name}`;
    await db.query(`delete from patients where clinic_id = $1 and last_name = $2`, [
      SEEDED_CLINICS.harbourStreet,
      last,
    ]);
    try {
      await db.query(
        `insert into patients (id, clinic_id, first_name, last_name, language)
         values (gen_random_uuid(), $1, 'Restore', $2, 'en')`,
        [SEEDED_CLINICS.harbourStreet, last],
      );
      const id = await visit(main, '09:00', { patient: ['Restore', last], status: 'cancelled' });
      await openCalendar(page, main, `Restore ${last}`);
      const open = await openDrawer(page, `Restore ${last}`);
      await db.query(
        `update patients set status = 'archived' where clinic_id = $1 and last_name = $2`,
        [SEEDED_CLINICS.harbourStreet, last],
      );
      await restoreButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(restore.refusals.patientNotBookable);
      expect(await stored(id)).toMatchObject({ status: 'cancelled' });
      expect(await statusRows(id)).toEqual([]);
      await expect(open).toBeVisible();
    } finally {
      await clear(main);
      await db.query(`delete from patients where clinic_id = $1 and last_name = $2`, [
        SEEDED_CLINICS.harbourStreet,
        last,
      ]);
    }
  });
});

test.describe('a double click on Restore, and a restore on its way (acceptance 4)', () => {
  // At 1280 px the drawer covers the grid's right part and the form stays where it was measured.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('80, 150 and 250 ms apart: the visit is restored once and no error shows', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'double');
    try {
      const rounds: [string, string, [string, string]][] = [
        ['09:00', 'Mimoza Kodra', ['Mimoza', 'Kodra']],
        ['10:00', 'Ana Brezovska', ['Ana', 'Brezovska']],
        ['11:00', 'Bojan Kamenov', ['Bojan', 'Kamenov']],
      ];
      const ids: string[] = [];
      for (const [start, , patient] of rounds) {
        ids.push(await visit(main, start, { patient, status: 'cancelled' }));
      }
      await openCalendar(page, main);
      const sent = restoresSent(page);
      for (const [index, gap] of [80, 150, 250].entries()) {
        const [, name] = rounds[index] ?? [];
        const id = ids[index];
        if (!name || !id) throw new Error('A round is missing.');
        const open = await openDrawer(page, name);
        const box = await restoreButton(open).boundingBox();
        if (!box) throw new Error('The drawer has no Restore button to point at.');
        const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(gap);
        await page.mouse.click(at.x, at.y);
        await expect(pill(open)).toHaveText(status.booked);
        await page.waitForTimeout(1_500);
        expect(sent, `${gap} ms: one request more`).toHaveLength(index + 1);
        expect(await statusRows(id), `${gap} ms: one audit row`).toHaveLength(1);
        // The second press changed nothing else: not in the chair, not moved, not cancelled.
        expect(await stored(id)).toMatchObject({ status: 'booked' });
        await expect(open.getByRole('alert'), `${gap} ms: no error`).toHaveCount(0);
        await closeDrawer(page, open);
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      }
    } finally {
      await clear(main);
    }
  });

  test('Escape and the overlay leave the drawer open while the restore is on its way', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'busy');
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    await page.route(`${APP}/calendar**`, async (route) => {
      if (!isRestore(route.request())) return route.fallback();
      held++;
      await released;
      return route.continue();
    });
    try {
      const id = await visit(main, '09:00', { status: 'cancelled' });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await restoreButton(open).click();
      await expect.poll(() => held, { message: 'the restore is sent, and held' }).toBe(1);

      await page.keyboard.press('Escape');
      await page.mouse.click(20, 400);
      await page.waitForTimeout(400);
      await expect(open, 'the drawer stays open while the restore is on its way').toBeVisible();

      release();
      await expect(pill(open)).toHaveText(status.booked);
      expect(await stored(id)).toMatchObject({ status: 'booked' });
      await closeDrawer(page, open);
    } finally {
      release();
      await clear(main);
    }
  });
});

test.describe('the keyboard and the accessibility check (acceptance 5)', () => {
  test('Tab reaches Restore anyway, Enter restores, the focus stays inside the drawer; axe passes with the overlap line showing', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'keys');
    try {
      const id = await visit(main, '09:00', { status: 'cancelled' });
      await visit(main, '09:15', { patient: ['Ana', 'Brezovska'] });
      await openCalendar(page, main);
      const open = await openDrawer(page);
      await expect(open.getByText(overlapLine('Ana Brezovska', '09:15', '09:45'))).toBeVisible();
      await expectNoAxeViolations(page);

      // From the drawer's own start, Tab until Restore anyway has the focus.
      await open.focus();
      for (let presses = 0; presses < 6; presses += 1) {
        if (
          await restoreButton(open, restore.restoreAnyway).evaluate(
            (n) => n === document.activeElement,
          )
        ) {
          break;
        }
        await page.keyboard.press('Tab');
      }
      await expect(restoreButton(open, restore.restoreAnyway)).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(pill(open)).toHaveText(status.booked);
      expect(await stored(id)).toMatchObject({ status: 'booked', overlapOk: true });
      expect(await statusRows(id)).toHaveLength(1);

      // The button that had the focus is gone: Radix's focus scope takes it into the drawer, not
      // out to the page.
      await expect
        .poll(
          () =>
            open.evaluate(
              (node) => node.contains(document.activeElement) && node !== document.body,
            ),
          { message: 'the focus is inside the drawer' },
        )
        .toBe(true);

      // The keyboard goes on from there: Escape closes the drawer and the focus is back on the block.
      await closeDrawer(page, open);
      await expect(block(page)).toBeFocused();
    } finally {
      await clear(main);
    }
  });
});

test.describe('a provider made inactive meanwhile (acceptance 3)', () => {
  test.use({ storageState: OWNER_SESSION });

  // The second seeded clinic, on a provider of the check's own (sort_order 100, after the seed's), so
  // no other spec's column or choice changes, even for a moment.
  const SONCOGLED = SEEDED_CLINICS.soncogled;
  const SONCOGLED_NAME = 'Забна клиника Сончоглед';

  test('the drawer is open on the cancelled visit, the provider is made inactive, Restore is pressed: the refusal shows above the button and nothing is written', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const main = dayOf(testInfo, 'inactive');
    const providerName = `Restore ${testInfo.project.name} Mira Testova`;
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
        [SONCOGLED, providerName, `R-${testInfo.project.name.slice(0, 3)}`],
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
                                   status, source, created_by, cancelled_at, cancelled_by)
         select gen_random_uuid(), $1,
                (select id from patients where clinic_id = $1 and status = 'active' order by id limit 1),
                $2, 'Checkup', ($3::date + time '09:00') at time zone 'Europe/Skopje',
                ($3::date + time '09:30') at time zone 'Europe/Skopje', 'cancelled', 'staff',
                (select user_id from memberships where clinic_id = $1 order by user_id limit 1),
                now(), 'staff'
         returning id`,
        [SONCOGLED, providerId, main],
      );
      const id = booked[0]?.id;
      if (!id) throw new Error('The visit was not written.');
      const state = async () => {
        const { rows } = await db.query<{ status: string }>(
          `select status from appointments where id = $1`,
          [id],
        );
        return rows[0]?.status;
      };
      const auditRows = async () => {
        const { rows } = await db.query<{ n: string }>(
          `select count(*) as n from audit_log
            where clinic_id = $1 and action = 'appointment.status_changed' and entity_id = $2`,
          [SONCOGLED, id],
        );
        return Number(rows[0]?.n);
      };

      await page.goto(`${APP}/choose-clinic`);
      await page.getByRole('button', { name: SONCOGLED_NAME }).click();
      await expect(page).toHaveURL(`${APP}/`);
      await openCalendar(page, main, patient);
      const open = await openDrawer(page, patient);

      // Another desk makes the provider inactive; this page does not know. Then Restore.
      await db.query(`update providers set active = false where id = $1`, [providerId]);
      await restoreButton(open).click();
      await expect(open.getByRole('alert')).toHaveText(restore.refusals.providerNotBookable);
      expect(await state()).toBe('cancelled');
      expect(await auditRows()).toBe(0);
      await expect(open).toBeVisible();
    } finally {
      await removeOwn();
    }
  });
});
