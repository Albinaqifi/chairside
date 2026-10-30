import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { expectNoAxeViolations } from './axe.ts';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T06b in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): a click or Enter on a visit's block opens the appointment drawer;
// the six status changes from it and the grid following at once; a refusal above the button; a visit
// that leaves the day closes it (the page's clock moved); a double click on a block whose second press
// lands on a status button; the keyboard, the focus back on the block, the accessibility check with
// the drawer open; the profile link and its one `patient.viewed` row. Each check works on a day of its
// browser's own and removes what it wrote. The visits are written as the migration role, as
// booking.spec.ts writes its rows. A no-show needs a visit that has started: it is on a day of August
// 2026, before this suite ever runs. Names are the seed's invented ones; the assertions on the
// database name ids and statuses only.

const t = messages.calendar.appointment;
const status = messages.appointmentStatus;

/** The days each browser works on, one a check: weekdays, open 08:00–18:00 like every weekday. */
const DAYS: Record<
  string,
  Record<'flow' | 'noShow' | 'refused' | 'leaves' | 'twice' | 'keys', string>
> = {
  chromium: {
    flow: '2032-01-05',
    noShow: '2026-08-03', // before today: the visit has started
    refused: '2032-01-12',
    leaves: '2032-01-19',
    twice: '2032-01-26',
    keys: '2032-02-02',
  },
  firefox: {
    flow: '2032-01-06',
    noShow: '2026-08-04',
    refused: '2032-01-13',
    leaves: '2032-01-20',
    twice: '2032-01-27',
    keys: '2032-02-03',
  },
  webkit: {
    flow: '2032-01-07',
    noShow: '2026-08-05',
    refused: '2032-01-14',
    leaves: '2032-01-21',
    twice: '2032-01-28',
    keys: '2032-02-04',
  },
};

function dayOf(testInfo: TestInfo, check: keyof (typeof DAYS)['chromium']): string {
  const day = DAYS[testInfo.project.name]?.[check];
  if (!day) throw new Error(`No day for the browser ${testInfo.project.name}.`);
  return day;
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
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + $3::time) at time zone 'Europe/Skopje',
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => $5),
            $6, 'staff', $7
       from patients p
      where p.clinic_id = $1 and p.first_name = $8 and p.last_name = $9
     returning id`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      start,
      options.provider ?? SEEDED_PROVIDERS.harbourStreetDentist,
      options.minutes ?? 30,
      options.status ?? 'booked',
      SEEDED_PEOPLE.frontDesk.id,
      first,
      last,
    ],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error(`The seed has no one ${first} ${last}.`);
  return rows[0].id;
}

/** Removes what a check wrote on its day, with the audit rows of those visits. */
async function clear(day: string): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await db.query<{ status: string }>(
    'select status from appointments where id = $1',
    [id],
  );
  return rows[0]?.status;
}

async function statusRows(id: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'appointment.status_changed' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return Number(rows[0]?.n);
}

async function patientIdOf(first: string, last: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from patients where clinic_id = $1 and first_name = $2 and last_name = $3`,
    [SEEDED_CLINICS.harbourStreet, first, last],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error('The seed holds one such patient.');
  return rows[0].id;
}

async function views(patientId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'patient.viewed' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, patientId],
  );
  return Number(rows[0]?.n);
}

/** The visit's block on the grid, a button, by the patient's name. */
const block = (page: Page, name = 'Mimoza Kodra') =>
  page.locator('button[data-appointment]').filter({ hasText: name });

/** The open drawer, named by the patient. */
const drawer = (page: Page, name = 'Mimoza Kodra') => page.getByRole('dialog', { name });

/** A button of the drawer's "Update status", by its text. */
const action = (open: Locator, name: string) => open.getByRole('button', { name, exact: true });

/** The status pill of the drawer. */
const pill = (open: Locator) => open.locator('[data-slot="badge"]');

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

/**
 * Lets the drawer's half second pass after it opened, before the first press of a pointer in it: a
 * press sooner is a double click's second, which it drops (E01-T05c, src/ui/double-click-guard.ts).
 */
async function pressable(page: Page): Promise<void> {
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
}

/** The status requests the page sends from now on: a server action that carries an appointment. */
function countChanges(page: Page): { changes: () => number } {
  let count = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] !== undefined &&
      (request.postData() ?? '').includes('appointmentId')
    ) {
      count += 1;
    }
  });
  return { changes: () => count };
}

test.describe('the status changes from the drawer (acceptance 3 and 4)', () => {
  test('a block opens it with the patient, treatment, time, provider and pill; each of the six changes shows in the drawer and on the grid at once, and a change that is not allowed has no button', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'flow');
    try {
      const id = await visit(day, '10:00');
      await openCalendar(page, day);
      const grid = page.locator('li[data-status]');
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await expect(open).toContainText('Checkup');
      await expect(open).toContainText('10:00–10:30');
      await expect(open).toContainText('Elena Planinska');
      await expect(pill(open)).toHaveText(status.booked);
      await pressable(page);

      // A visit that has not started: no No-show, and nothing to undo; no Restore. Cancel (E01-T06e)
      // opens its dialog (appointment-cancel.spec.ts).
      for (const name of ['In the chair', 'Done', 'Confirm', 'Cancel']) {
        await expect(action(open, name)).toBeVisible();
      }
      for (const name of ['No-show', 'Undo in the chair', 'Undo done', 'Restore']) {
        await expect(action(open, name), `no ${name}`).toHaveCount(0);
      }

      // Confirm: booked to confirmed.
      await action(open, 'Confirm').click();
      await expect(pill(open)).toHaveText(status.confirmed);
      await expect(grid).toHaveAttribute('data-status', 'confirmed');
      await expect(action(open, 'Confirm')).toHaveCount(0);
      // The toast shows above the open drawer. The drawer hides the rest of the page from a screen
      // reader, the toast's region too (includeHidden): the handoff note names it.
      await expect(
        page
          .getByRole('region', { name: 'Notifications (F8)', includeHidden: true })
          .getByText(t.actions.confirm.done),
      ).toBeVisible();
      await expect(open, 'the drawer stays open').toBeVisible();

      // In the chair, then back out of it: a confirmed visit returns to confirmed.
      await action(open, 'In the chair').click();
      await expect(pill(open)).toHaveText(status.arrived);
      await expect(grid).toHaveAttribute('data-status', 'arrived');
      await expect(action(open, 'Done')).toBeVisible();
      await expect(action(open, 'Undo in the chair')).toBeVisible();
      await expect(action(open, 'In the chair')).toHaveCount(0);
      await action(open, 'Undo in the chair').click();
      await expect(pill(open)).toHaveText(status.confirmed);
      await expect(grid).toHaveAttribute('data-status', 'confirmed');

      // In the chair, Done, then Undo done: the same day, so back in the chair.
      await action(open, 'In the chair').click();
      await expect(pill(open)).toHaveText(status.arrived);
      await action(open, 'Done').click();
      await expect(pill(open)).toHaveText(status.completed);
      await expect(grid).toHaveAttribute('data-status', 'completed');
      await expect(action(open, 'Undo done')).toBeVisible();
      for (const name of ['In the chair', 'Done', 'Confirm', 'No-show']) {
        await expect(action(open, name), `no ${name} on a done visit`).toHaveCount(0);
      }
      await action(open, 'Undo done').click();
      await expect(pill(open)).toHaveText(status.arrived);
      await expect(grid).toHaveAttribute('data-status', 'arrived');

      expect(await statusOf(id)).toBe('arrived');
      // One audit row for each of the six presses, not one for a press the form held back.
      expect(await statusRows(id)).toBe(6);
    } finally {
      await clear(day);
    }
  });

  test('a visit that has started offers No-show, which marks it; nothing is left to change after it', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'noShow');
    try {
      const id = await visit(day, '10:00');
      await openCalendar(page, day);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      for (const name of ['In the chair', 'Done', 'No-show', 'Confirm']) {
        await expect(action(open, name)).toBeVisible();
      }
      await action(open, 'No-show').click();
      await expect(pill(open)).toHaveText(status.no_show);
      await expect(page.locator('li[data-status]')).toHaveAttribute('data-status', 'no_show');
      // Restore is the next task's: the drawer shows a muted line, no heading and no button.
      await expect(open.getByText(t.nothingToChange)).toBeVisible();
      await expect(open.getByText(t.update)).toHaveCount(0);
      await expect(open.locator('form')).toHaveCount(0);
      expect(await statusOf(id)).toBe('no_show');
      expect(await statusRows(id)).toBe(1);
    } finally {
      await clear(day);
    }
  });
});

test.describe('a refusal, and a visit that goes (acceptance 5)', () => {
  test('a visit changed meanwhile, and one that is gone: the text above the button, the drawer open', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'refused');
    try {
      const changed = await visit(day, '09:00');
      const gone = await visit(day, '11:00', { patient: ['Bojan', 'Kamenov'] });
      await openCalendar(page, day);

      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      // Someone else finished it after the page was read: the table says no.
      await db.query(
        `update appointments set status = 'completed', completed_at = now() where id = $1`,
        [changed],
      );
      await action(open, 'In the chair').click();
      await expect(open.getByRole('alert')).toHaveText(t.refusals.notAllowed);
      await expect(open, 'the drawer stays open').toBeVisible();
      await expect(pill(open), 'still as read').toHaveText(status.booked);
      expect(await statusOf(changed)).toBe('completed');
      expect(await statusRows(changed)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(open).toBeHidden();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);

      await block(page, 'Bojan Kamenov').click();
      const other = drawer(page, 'Bojan Kamenov');
      await expect(other).toBeVisible();
      await pressable(page);
      await db.query('delete from appointments where id = $1', [gone]);
      await action(other, 'Done').click();
      await expect(other.getByRole('alert')).toHaveText(t.refusals.notFound);
      await expect(other).toBeVisible();
    } finally {
      await clear(day);
    }
  });

  test('a visit the day no longer holds closes the drawer when the day is read again', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'leaves');
    try {
      const id = await visit(day, '09:00');
      await page.clock.install();
      await openCalendar(page, day);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();

      // The visit is gone; 31 seconds after the page's read, a use reads the day again.
      await db.query('delete from appointments where id = $1', [id]);
      await page.clock.fastForward(31_000);
      // The open drawer hides the page's roles from the tree: the heading is found by its tag.
      const title = page.locator('h1');
      const box = await title.boundingBox();
      if (!box) throw new Error('The title has no box to move the pointer over.');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
      await page.keyboard.press('Shift');
      await expect(open).toBeHidden();
      await expect(page.locator('button[data-appointment]')).toHaveCount(0);
    } finally {
      await clear(day);
    }
  });
});

test.describe('a double click on a block: its second press lands on a status button (acceptance 6)', () => {
  // At 1280 px the drawer covers the grid's right part: the hygienist's column lies under it.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('80, 150 and 250 ms apart: the drawer is open and no status is changed', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'twice');
    const hygienist = SEEDED_PROVIDERS.harbourStreetHygienist;
    try {
      // The column is full from 08:00 to 10:00, so a block is under the pointer wherever the button is.
      const ids: string[] = [];
      for (const start of ['08:00', '08:30', '09:00', '09:30']) {
        ids.push(await visit(day, start, { provider: hygienist }));
      }
      await openCalendar(page, day);
      const changes = countChanges(page);

      // Where "In the chair" opens: measured on a drawer opened once, then closed.
      await block(page).first().click();
      let open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      const box = await action(open, 'In the chair').boundingBox();
      if (!box) throw new Error('The drawer has no In the chair button to point at.');
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.keyboard.press('Escape');
      await expect(open).toBeHidden();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      expect(
        await page.evaluate(
          ({ x, y }) =>
            document.elementFromPoint(x, y)?.closest('button[data-appointment]') != null,
          at,
        ),
        'a block is under the button',
      ).toBe(true);

      // From now on, each press the page gets: when, and the button under it.
      await page.evaluate(() => {
        const found: { at: number; button: string }[] = [];
        (window as unknown as { found: typeof found }).found = found;
        document.addEventListener(
          'pointerdown',
          (event) => {
            const target = event.target instanceof Element ? event.target : null;
            found.push({
              at: event.timeStamp,
              button: target?.closest('button')?.textContent?.trim() ?? '',
            });
          },
          true,
        );
      });
      const presses = () =>
        page.evaluate(
          () => (window as unknown as { found: { at: number; button: string }[] }).found,
        );

      let checked = 0;
      for (const gap of [80, 150, 250]) {
        await page.evaluate(() => {
          (window as unknown as { found: unknown[] }).found.length = 0;
        });
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(gap);
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(700);
        const [first, second] = await presses();
        if (!first || !second) throw new Error(`${gap} ms: the page got fewer than two presses.`);
        open = page.getByRole('dialog');
        if (second.at - first.at < 450) {
          checked += 1;
          expect(second.button, `${gap} ms: the second press was on the status button`).toBe(
            'In the chair',
          );
          await expect(open, `${gap} ms: the drawer is open`).toBeVisible();
          expect(changes.changes(), `${gap} ms: no status request`).toBe(0);
        } else {
          test.info().annotations.push({
            type: 'not checked',
            description: `${gap} ms: the two presses reached the page ${Math.round(second.at - first.at)} ms apart`,
          });
        }
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      }
      expect(checked, 'at least one double click reached the page as one').toBeGreaterThan(0);

      await page.waitForLoadState('networkidle');
      expect(changes.changes()).toBe(0);
      for (const id of ids) expect(await statusOf(id)).toBe('booked');

      // A press from half a second on works as before: the same press changes the status.
      await page.mouse.click(at.x, at.y);
      await expect(page.getByRole('dialog')).toBeVisible();
      await pressable(page);
      await page.mouse.click(at.x, at.y);
      await expect(pill(page.getByRole('dialog'))).toHaveText(status.arrived);
    } finally {
      await clear(day);
    }
  });
});

test.describe('the keyboard, the focus, the profile and the rest of the grid (acceptance 3, 7)', () => {
  test('Tab to a block and Enter open the drawer, named for a screen reader; Escape closes it and the focus goes back to the block; the accessibility check passes with it open', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'keys');
    try {
      await visit(day, '09:00');
      await openCalendar(page, day);

      // Tab from New appointment to the block: it is in the page's tab order.
      await page.getByRole('button', { name: messages.calendar.booking.open, exact: true }).focus();
      const onBlock = () =>
        page.evaluate(() => document.activeElement?.hasAttribute('data-appointment') === true);
      for (let presses = 0; presses < 10 && !(await onBlock()); presses += 1) {
        await page.keyboard.press('Tab');
      }
      expect(await onBlock(), 'Tab reached the block').toBe(true);
      await page.keyboard.press('Enter');
      const open = drawer(page);
      await expect(open).toBeVisible();
      await expect(pill(open)).toHaveText(status.booked);
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      await expectNoAxeViolations(page);

      await page.keyboard.press('Escape');
      await expect(open).toBeHidden();
      await expect(block(page), 'the focus is back on the block').toBeFocused();

      // And by a pointer: a clicked button is not focused in every browser; the close button closes.
      await block(page).click();
      await expect(open).toBeVisible();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      await open.getByRole('button', { name: messages.drawer.close }).click();
      await expect(open).toBeHidden();
      await expect(block(page), 'the focus is back on the block').toBeFocused();
    } finally {
      await clear(day);
    }
  });

  test('opening the drawer writes no patient view; the Patient profile link opens the profile and writes one', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'keys');
    try {
      await visit(day, '09:00');
      const patientId = await patientIdOf('Mimoza', 'Kodra');
      const before = await views(patientId);
      await openCalendar(page, day);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      // The link is on the page: a prefetch would have written a row by now.
      const link = open.getByRole('link', { name: t.profile });
      await expect(link).toHaveAttribute('href', `/patients/${patientId}`);
      await page.waitForTimeout(1_500);
      expect(await views(patientId), 'the drawer and the link wrote no view').toBe(before);

      await pressable(page);
      await link.click();
      await page.waitForURL(`${APP}/patients/${patientId}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Mimoza Kodra');
      expect(await views(patientId), 'one view for the one profile opened').toBe(before + 1);
    } finally {
      await clear(day);
    }
  });

  test('a break opens nothing; an empty slot and New appointment open the booking drawer as before', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'keys');
    try {
      await visit(day, '09:00');
      await openCalendar(page, day);
      // The dentist's lunch, hatched, is no button.
      const lunch = page.locator('li[data-break]').first();
      await expect(lunch).toBeVisible();
      await expect(lunch.locator('button')).toHaveCount(0);
      await lunch.click();
      await page.waitForTimeout(400);
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.getByRole('button', { name: messages.calendar.booking.open, exact: true }).click();
      const booking = page.getByRole('dialog', { name: messages.calendar.booking.title });
      await expect(booking).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(booking).toBeHidden();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);

      // An empty slot of the second dentist's column, below 09:00 and clear of every visit.
      const second = page.getByRole('list', { name: 'Arben Kodra' });
      const box = await second.boundingBox();
      if (!box) throw new Error('No column for the second dentist.');
      await page.mouse.click(box.x + box.width / 2, box.y + 300);
      await expect(booking).toBeVisible();
    } finally {
      await clear(day);
    }
  });
});
