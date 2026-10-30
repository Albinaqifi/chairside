import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { expectNoAxeViolations } from './axe.ts';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T06e in real browsers, on the production build, as the seeded front desk: the Cancel button of
// the appointment drawer opens a dialog over it that asks who cancelled and why. The cancel sent once,
// as the one request that writes one `appointment.status_changed` row, the drawer's other forms
// sending nothing; who cancelled required, and the reason kept in the row and in no audit row; the
// keyboard, Escape in the dialog, and the focus after the cancel; the accessibility check with the
// dialog open; the drawer and the dialog staying open while a request is on its way (the answer held
// with page.route, as booking.spec.ts holds the patient search's), a form that leaves while it sends
// leaving the drawer closable; a double click on Cancel whose second press lands on the dialog's
// select or its Cancel visit button. Each check works on a day of its browser's own and removes what
// it wrote. The visits are written as the migration role. Names are the seed's invented ones; the
// assertions on the database name ids and statuses only.

const t = messages.calendar.appointment;
const dialogText = t.cancelDialog;
const status = messages.appointmentStatus;

/** The days each browser works on, one a check: weekdays, open 08:00–18:00 like every weekday. */
const DAYS: Record<
  string,
  Record<'flow' | 'keys' | 'heldDialog' | 'heldStatus' | 'leaves' | 'twice', string>
> = {
  chromium: {
    flow: '2032-03-01',
    keys: '2032-03-02',
    heldDialog: '2032-03-03',
    heldStatus: '2032-03-04',
    leaves: '2032-03-05',
    twice: '2032-03-08',
  },
  firefox: {
    flow: '2032-03-09',
    keys: '2032-03-10',
    heldDialog: '2032-03-11',
    heldStatus: '2032-03-12',
    leaves: '2032-03-15',
    twice: '2032-03-16',
  },
  webkit: {
    flow: '2032-03-17',
    keys: '2032-03-18',
    heldDialog: '2032-03-19',
    heldStatus: '2032-03-22',
    leaves: '2032-03-23',
    twice: '2032-03-24',
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

/** A visit as the migration role writes it: the patient of that name, the dentist, a local start. */
async function visit(
  day: string,
  start: string,
  patient: [string, string] = ['Mimoza', 'Kodra'],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + $3::time) at time zone 'Europe/Skopje',
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => 30),
            'booked', 'staff', $5
       from patients p
      where p.clinic_id = $1 and p.first_name = $6 and p.last_name = $7
     returning id`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      start,
      SEEDED_PROVIDERS.harbourStreetDentist,
      SEEDED_PEOPLE.frontDesk.id,
      patient[0],
      patient[1],
    ],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error(`The seed has no one ${patient.join(' ')}.`);
  return rows[0].id;
}

/** Removes what a check wrote on its day. */
async function clear(day: string): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
}

interface Row {
  status: string;
  cancelled_by: string | null;
  cancel_reason: string | null;
  cancelled: boolean;
}

async function rowOf(id: string): Promise<Row | undefined> {
  const { rows } = await db.query<Row>(
    `select status, cancelled_by, cancel_reason, cancelled_at is not null as cancelled
       from appointments where id = $1`,
    [id],
  );
  return rows[0];
}

/** The `appointment.status_changed` rows of the visit, with their metadata as text. */
async function auditOf(id: string): Promise<string[]> {
  const { rows } = await db.query<{ metadata: string }>(
    `select metadata::text as metadata from audit_log
      where clinic_id = $1 and action = 'appointment.status_changed' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return rows.map((row) => row.metadata);
}

/** The visit's block on the grid, a button, by the patient's name. */
const block = (page: Page, name = 'Mimoza Kodra') =>
  page.locator('button[data-appointment]').filter({ hasText: name });

/** The open appointment drawer, named by the patient. */
const drawer = (page: Page, name = 'Mimoza Kodra') => page.getByRole('dialog', { name });

/** The cancel dialog, named by its title. */
const cancelDialog = (page: Page) => page.getByRole('dialog', { name: dialogText.title });

/** A button of the drawer, by its text. */
const button = (open: Locator, name: string) => open.getByRole('button', { name, exact: true });

/** The status pill of the drawer. */
const pill = (open: Locator) => open.locator('[data-slot="badge"]');

/** Opens the calendar on `day` once React has hydrated the visit's block and the page has settled. */
async function openCalendar(page: Page, day: string, name = 'Mimoza Kodra'): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const first = block(page, name).first();
  await expect(first).toBeVisible();
  await expect
    .poll(
      () =>
        first.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the calendar' },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

/**
 * Lets the half second after a drawer or a dialog opened pass, before the first press of a pointer in
 * it: a press sooner is a double click's second, which it drops (src/ui/double-click-guard.ts).
 */
async function pressable(page: Page): Promise<void> {
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
}

/** The bodies of the requests that carry an appointment (a status change), from now on. */
function recordChanges(page: Page): { bodies: () => string[] } {
  const bodies: string[] = [];
  page.on('request', (request) => {
    const body = request.postData() ?? '';
    if (
      request.method() === 'POST' &&
      request.headers()['next-action'] !== undefined &&
      body.includes('appointmentId')
    ) {
      bodies.push(body);
    }
  });
  return { bodies: () => bodies };
}

/**
 * Holds every status request (a server action whose body carries an appointment) until `release()`:
 * the answer is on its way for as long as a check wants.
 */
async function holdChanges(page: Page): Promise<{ release: () => void; held: () => number }> {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(`${APP}/calendar**`, async (route) => {
    const request = route.request();
    const change =
      request.method() === 'POST' &&
      request.headers()['next-action'] !== undefined &&
      (request.postData() ?? '').includes('appointmentId');
    if (!change) return route.fallback();
    held++;
    await released;
    return route.continue();
  });
  return { release: () => release(), held: () => held };
}

/**
 * Escape for the toast a change showed, which is a layer above the drawer and takes the first Escape;
 * then waits until no toast shows (as booking.spec.ts does after a booking).
 */
async function closeToast(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Notifications (F8)' }).getByRole('listitem'),
    'no toast up',
  ).toHaveCount(0);
}

/**
 * Escape, until the layer is gone. The answer is on the page a moment before the layer hears that
 * nothing is sending (an effect, then Radix's own), so an Escape right after the answer shows can
 * come first and be held back: a person's comes later. Pressed again only while the layer shows.
 */
async function escapeUntilHidden(page: Page, layer: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(layer).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/** Whether the focus is inside the open drawer (not on the page behind it, not on the body). */
async function focusInDrawer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const content = document.querySelector('[data-slot="sheet-content"]');
    return content !== null && content.contains(document.activeElement);
  });
}

test.describe('cancelling from the dialog over the drawer (acceptance 1 and 2)', () => {
  test('Cancel is the last button; with nothing chosen the send is refused at the field and writes nothing; "The patient" and "The clinic" are written, the reason in the row and in no audit row; the cancel is one request of the dialog alone', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'flow');
    try {
      const patientVisit = await visit(day, '09:00');
      const clinicVisit = await visit(day, '10:00', ['Bojan', 'Kamenov']);
      await openCalendar(page, day);
      const sent = recordChanges(page);

      // The patient cancelled, with a reason.
      await block(page).click();
      let open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      await expect(open.locator('section button').last(), 'Cancel is the last button').toHaveText(
        t.actions.cancel.label,
      );
      await button(open, t.actions.cancel.label).click();
      const dialog = cancelDialog(page);
      await expect(dialog).toBeVisible();
      const who = dialog.getByLabel(dialogText.who, { exact: true });
      await expect(who, 'no one chosen at first').toHaveValue('');
      await pressable(page);

      await button(dialog, dialogText.submit).click();
      await expect(
        dialog.getByText(messages.form.fieldErrors.missing),
        'refused at the field',
      ).toBeVisible();
      await expect(who).toHaveAttribute('aria-invalid', 'true');
      await expect(dialog, 'the dialog stays open').toBeVisible();
      expect(await rowOf(patientVisit), 'nothing written').toMatchObject({
        status: 'booked',
        cancelled: false,
      });
      expect(await auditOf(patientVisit)).toEqual([]);

      const reason = 'Called to say they are ill';
      await who.selectOption({ label: dialogText.patient });
      await dialog.getByLabel(dialogText.reason, { exact: true }).fill(reason);
      await button(dialog, dialogText.submit).click();
      await expect(dialog).toBeHidden();
      await expect(open, 'the drawer stays open').toBeVisible();
      await expect(pill(open)).toHaveText(status.cancelled);
      await expect(
        page.locator('li[data-status]').filter({ hasText: 'Mimoza Kodra' }),
      ).toHaveAttribute('data-status', 'cancelled');
      expect(await rowOf(patientVisit)).toMatchObject({
        status: 'cancelled',
        cancelled_by: 'patient',
        cancel_reason: reason,
        cancelled: true,
      });
      const audit = await auditOf(patientVisit);
      expect(audit, 'one audit row').toHaveLength(1);
      expect(audit.join(), 'the reason in no audit row').not.toContain(reason);
      // The cancel gone, the muted line stands; the focus is in the drawer, not lost on the page.
      await expect(button(open, t.actions.cancel.label)).toHaveCount(0);
      await expect(open.getByText(t.nothingToChange)).toBeVisible();
      await expect
        .poll(() => focusInDrawer(page), { message: 'the focus is in the drawer' })
        .toBe(true);

      // Two requests, the refused one and the cancel: both are the dialog's form, and no other form of
      // the drawer sent anything.
      expect(sent.bodies()).toHaveLength(2);
      for (const body of sent.bodies()) {
        expect(body).toContain('cancel');
        for (const other of ['arrive', 'complete', 'no_show', 'confirm']) {
          expect(body, `not the ${other} form`).not.toContain(other);
        }
      }

      // The clinic cancelled, without a reason.
      await closeToast(page);
      await page.keyboard.press('Escape');
      await expect(open).toBeHidden();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      await block(page, 'Bojan Kamenov').click();
      open = drawer(page, 'Bojan Kamenov');
      await expect(open).toBeVisible();
      await pressable(page);
      await button(open, t.actions.cancel.label).click();
      await expect(dialog).toBeVisible();
      await pressable(page);
      await dialog
        .getByLabel(dialogText.who, { exact: true })
        .selectOption({ label: dialogText.staff });
      await button(dialog, dialogText.submit).click();
      await expect(dialog).toBeHidden();
      await expect(pill(open)).toHaveText(status.cancelled);
      expect(await rowOf(clinicVisit)).toMatchObject({
        status: 'cancelled',
        cancelled_by: 'staff',
        cancel_reason: null,
      });
      expect(await auditOf(clinicVisit)).toHaveLength(1);
    } finally {
      await clear(day);
    }
  });
});

test.describe('by keyboard alone, Escape in the dialog, the accessibility check (acceptance 6)', () => {
  test('Tab to Cancel and Enter open the dialog; Escape closes it only and the focus is back on Cancel; with it open the check passes; the keys choose and send; the focus ends in the drawer', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'keys');
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);

      const cancel = button(open, t.actions.cancel.label);
      const onCancel = () =>
        page.evaluate(() => document.activeElement?.textContent?.trim() === 'Cancel');
      for (let presses = 0; presses < 10 && !(await onCancel()); presses += 1) {
        await page.keyboard.press('Tab');
      }
      expect(await onCancel(), 'Tab reached Cancel').toBe(true);
      await page.keyboard.press('Enter');
      const dialog = cancelDialog(page);
      await expect(dialog).toBeVisible();
      const who = dialog.getByLabel(dialogText.who, { exact: true });
      await expect(who, 'the focus in the first field').toBeFocused();
      await pressable(page);
      await expectNoAxeViolations(page);

      // Escape closes the dialog, not the drawer, and the focus goes back to what opened it.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(open, 'the drawer stays open').toBeVisible();
      await expect(cancel, 'the focus is back on Cancel').toBeFocused();

      // Again: the keys choose a person, go to the button and send.
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await expect(who).toBeFocused();
      await pressable(page);
      await page.keyboard.press('ArrowDown');
      await expect(who, 'the arrow key chose the first person').toHaveValue('patient');
      await page.keyboard.press('Tab'); // the reason
      await page.keyboard.press('Tab'); // Cancel visit
      await expect(button(dialog, dialogText.submit)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(pill(open)).toHaveText(status.cancelled);
      await expect
        .poll(() => focusInDrawer(page), { message: 'the focus is in the drawer' })
        .toBe(true);
      expect(await rowOf(id)).toMatchObject({ status: 'cancelled', cancelled_by: 'patient' });
      // Escape now closes the drawer: the focus is inside it, and nothing is left sending.
      await closeToast(page);
      await page.keyboard.press('Escape');
      await expect(open).toBeHidden();
    } finally {
      await clear(day);
    }
  });
});

test.describe('the dialog and the drawer stay open while a request is on its way (acceptance 3)', () => {
  test('the cancel dialog: Escape, Close and the overlay wait for the answer, a refusal shows above the button, then Escape closes only the dialog', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'heldDialog');
    const hold = await holdChanges(page);
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      await button(open, t.actions.cancel.label).click();
      const dialog = cancelDialog(page);
      await expect(dialog).toBeVisible();
      await pressable(page);
      await dialog
        .getByLabel(dialogText.who, { exact: true })
        .selectOption({ label: dialogText.staff });
      // Someone else finished the visit after the page was read: the table says no.
      await db.query(
        `update appointments set status = 'completed', completed_at = now() where id = $1`,
        [id],
      );
      await button(dialog, dialogText.submit).click();
      await expect.poll(() => hold.held(), { message: 'the cancel is sent, and held' }).toBe(1);

      await page.keyboard.press('Escape');
      await expect(dialog, 'Escape').toBeVisible();
      await dialog.getByRole('button', { name: messages.dialog.close }).click();
      await expect(dialog, 'Close').toBeVisible();
      await page.mouse.click(8, 8);
      await expect(dialog, 'the overlay').toBeVisible();
      await page.waitForTimeout(300);
      await expect(dialog).toBeVisible();
      // The drawer under it, which the open dialog hides from the tree: found by its tag.
      await expect(
        page.locator('[data-slot="sheet-content"]'),
        'and the drawer under it',
      ).toBeVisible();

      hold.release();
      await expect(dialog.getByRole('alert')).toHaveText(t.refusals.notAllowed);
      await expect(dialog, 'the refusal shows in the open dialog').toBeVisible();
      expect(await rowOf(id)).toMatchObject({ status: 'completed', cancelled: false });
      expect(await auditOf(id)).toEqual([]);

      // The answer is in: Escape closes the dialog, not the drawer, and the focus goes to Cancel.
      await escapeUntilHidden(page, dialog);
      await expect(open).toBeVisible();
      await expect(button(open, t.actions.cancel.label)).toBeFocused();
    } finally {
      hold.release();
      await clear(day);
    }
  });

  test("the drawer: a status form's request on its way keeps it open on Escape, Close and the overlay, and its refusal shows above the button; Escape closes it once the answer is in", async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'heldStatus');
    const hold = await holdChanges(page);
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      await db.query(
        `update appointments set status = 'completed', completed_at = now() where id = $1`,
        [id],
      );
      await button(open, 'In the chair').click();
      await expect.poll(() => hold.held(), { message: 'the change is sent, and held' }).toBe(1);

      await page.keyboard.press('Escape');
      await expect(open, 'Escape').toBeVisible();
      await open.getByRole('button', { name: messages.drawer.close }).click();
      await expect(open, 'Close').toBeVisible();
      await page.mouse.click(100, 400);
      await expect(open, 'the overlay').toBeVisible();
      await page.waitForTimeout(300);
      await expect(open).toBeVisible();

      hold.release();
      await expect(open.getByRole('alert')).toHaveText(t.refusals.notAllowed);
      await expect(open, 'the refusal shows in the open drawer').toBeVisible();
      await escapeUntilHidden(page, open);
    } finally {
      hold.release();
      await clear(day);
    }
  });

  test('a change that replaces its own button leaves the drawer closable: In the chair, then Escape', async ({
    page,
  }, testInfo) => {
    // The day comes back with the answer and the button goes (its form with it) while the form may
    // still be sending: the drawer must not be left waiting for it.
    const day = dayOf(testInfo, 'leaves');
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);
      await button(open, 'In the chair').click();
      await expect(pill(open)).toHaveText(status.arrived);
      await expect(button(open, 'In the chair'), 'its button is gone').toHaveCount(0);
      expect(await rowOf(id)).toMatchObject({ status: 'arrived' });

      await closeToast(page);
      await page.keyboard.press('Escape');
      await expect(open, 'Escape closes the drawer').toBeHidden();
    } finally {
      await clear(day);
    }
  });
});

test.describe("a double click on Cancel: its second press on the dialog's select or button (acceptance 5)", () => {
  // At 1280 px the dialog sits over the grid and the drawer's left part.
  test.use({ viewport: { width: 1280, height: 800 } });

  type Target = 'select' | 'submit';
  const TARGETS: readonly Target[] = ['select', 'submit'];
  interface Point {
    x: number;
    y: number;
  }

  async function centre(target: Locator): Promise<Point> {
    const box = await target.boundingBox();
    if (!box) throw new Error('Nothing to point at: the element has no box.');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Records each pointer down the page gets: its time stamp and what it landed on. */
  async function recordPresses(page: Page): Promise<void> {
    await page.evaluate(() => {
      const found: { at: number; place: string }[] = [];
      (window as unknown as { found: typeof found }).found = found;
      document.addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          let place = 'other';
          if (target?.closest('select')) place = 'select';
          else if (target?.closest('button')?.textContent?.trim() === 'Cancel visit')
            place = 'submit';
          else if (target?.closest('[data-slot="dialog-overlay"]')) place = 'overlay';
          found.push({ at: event.timeStamp, place });
        },
        true,
      );
    });
  }
  const presses = (page: Page) =>
    page.evaluate(() => (window as unknown as { found: { at: number; place: string }[] }).found);

  test('80, 150 and 250 ms apart: nothing is chosen or sent, the dialog is open, no list of the select is open; a press half a second on sends', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const day = dayOf(testInfo, 'twice');
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      const sent = recordChanges(page);
      await block(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      await pressable(page);

      // Where Cancel is, and where the dialog's select and button open: measured on one opening.
      const trigger = await centre(button(open, t.actions.cancel.label));
      await page.mouse.click(trigger.x, trigger.y);
      const dialog = cancelDialog(page);
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(400); // its entrance done
      const points: Record<Target, Point> = {
        select: await centre(dialog.getByLabel(dialogText.who, { exact: true })),
        submit: await centre(button(dialog, dialogText.submit)),
      };
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await pressable(page);
      await recordPresses(page);

      const checked: Target[] = [];
      for (const target of TARGETS) {
        for (const gap of [80, 150, 250]) {
          const label = `${target}, ${gap} ms`;
          await page.evaluate(() => {
            (window as unknown as { found: unknown[] }).found.length = 0;
          });
          await page.mouse.click(trigger.x, trigger.y);
          await page.waitForTimeout(gap);
          await page.mouse.click(points[target].x, points[target].y);
          await page.waitForTimeout(700);
          const [first, second] = await presses(page);
          if (!first || !second) throw new Error(`${label}: the page got fewer than two presses.`);
          if (second.at - first.at < 450) {
            checked.push(target);
            expect(second.place, `${label}: the second press on the ${target}`).toBe(target);
            await expect(dialog, `${label}: open`).toBeVisible();
            await expect(
              dialog.getByLabel(dialogText.who, { exact: true }),
              `${label}: nothing chosen`,
            ).toHaveValue('');
            await expect(
              dialog.getByText(messages.form.fieldErrors.missing),
              `${label}: Cancel visit was not pressed`,
            ).toHaveCount(0);
            expect(sent.bodies(), `${label}: nothing sent`).toEqual([]);
            // No list of the select is open: the one Escape closes the dialog (an open list would
            // take it). A native list is no part of the page, so this is how it shows.
            await page.keyboard.press('Escape');
            await expect(dialog, `${label}: one Escape closes the dialog`).toBeHidden();
          } else {
            test.info().annotations.push({
              type: 'not checked',
              description: `${label}: the two presses reached the page ${Math.round(second.at - first.at)} ms apart`,
            });
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
          }
          await expect(open, `${label}: the drawer is open`).toBeVisible();
          await pressable(page);
        }
      }
      for (const target of TARGETS) {
        expect(checked, `a double click checked on the ${target}`).toContain(target);
      }
      expect(await rowOf(id)).toMatchObject({ status: 'booked', cancelled: false });

      // A press from half a second on works as before: Cancel visit, pressed with nothing chosen,
      // says so.
      await page.mouse.click(trigger.x, trigger.y);
      await expect(dialog).toBeVisible();
      await pressable(page);
      await page.mouse.click(points.submit.x, points.submit.y);
      await expect(dialog.getByText(messages.form.fieldErrors.missing)).toBeVisible();
    } finally {
      await clear(day);
    }
  });
});
