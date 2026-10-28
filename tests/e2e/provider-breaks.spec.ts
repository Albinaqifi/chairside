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
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T09e in real browsers, on the production build, as the seeded owner (the global setup's
// session; no sign-in of its own), in the second seeded clinic. Acceptance 1: a break added in a
// provider's Breaks dialog is hatched on the calendar on its weekday and warned about in the booking
// drawer, and a removed one is gone from both; the keyboard is at the weekday after an add and at the
// list's heading after a remove. Acceptance 2 (the dialog's side): a break overlapping another of the
// provider's that weekday is refused above the button and nothing is added; back to back is added.
// Acceptance 4: a double click on a break's Remove, its two clicks 80, 150 and 250 ms apart, removes
// one break, once.
//
// The seed gives every seeded provider a lunch break on every working day, which the calendar and
// booking checks count on: each check here adds a provider of its own (named by its browser) and its
// breaks, never touches the seed's providers, and removes what it wrote. The three browsers share the
// clinic, so a day each, far from every other check's days. Names and labels are invented; the
// patient is the seed's.

const t = messages.settings.providers;
const booking = messages.calendar.booking;

const CLINIC_NAME = 'Забна клиника Сончоглед';
const CLINIC = SEEDED_CLINICS.soncogled;

/** Each browser's day for the calendar: a weekday (`weekday`, ISO), far from every other check's days. */
const DAYS: Record<string, { day: string; weekday: number }> = {
  chromium: { day: '2031-12-01', weekday: 1 },
  firefox: { day: '2031-12-02', weekday: 2 },
  webkit: { day: '2031-12-03', weekday: 3 },
};

function dayOf(testInfo: TestInfo) {
  const found = DAYS[testInfo.project.name];
  if (!found) throw new Error(`No day for the browser ${testInfo.project.name}.`);
  return found;
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday'];

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

/**
 * Removes the clinic's providers whose names start with `prefix`, their breaks and the treatment types
 * of the same prefix. The audit rows stay, ids alone: the log is never cleaned.
 */
async function removeOwn(prefix: string): Promise<void> {
  await db.query(
    `delete from appointments where clinic_id = $1 and treatment_type_id in
       (select id from treatment_types where clinic_id = $1 and starts_with(name, $2))`,
    [CLINIC, prefix],
  );
  await db.query(
    `delete from provider_breaks where clinic_id = $1 and provider_id in
       (select id from providers where clinic_id = $1 and starts_with(name, $2))`,
    [CLINIC, prefix],
  );
  await db.query(`delete from providers where clinic_id = $1 and starts_with(name, $2)`, [
    CLINIC,
    prefix,
  ]);
  await db.query(`delete from treatment_types where clinic_id = $1 and starts_with(name, $2)`, [
    CLINIC,
    prefix,
  ]);
}

/** Writes an active dentist after the seed's, as the migration role; gives its id. */
async function addProvider(name: string, shortName: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into providers (id, clinic_id, name, short_name, kind, chair_label, color_hue, sort_order)
     values (gen_random_uuid(), $1, $2, $3, 'dentist', 'Chair 8', 40, 100) returning id`,
    [CLINIC, name, shortName],
  );
  return rows[0]!.id;
}

/** Writes an active treatment type of this name, 30 minutes, as the migration role. */
async function addType(name: string): Promise<void> {
  await db.query(
    `insert into treatment_types (id, clinic_id, name, default_duration_min)
     values (gen_random_uuid(), $1, $2, 30)`,
    [CLINIC, name],
  );
}

/** Writes a break as the migration role; gives its id. */
async function addStoredBreak(
  providerId: string,
  weekday: number,
  starts: string,
  ends: string,
  label: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into provider_breaks (id, clinic_id, provider_id, weekday, starts, ends, label)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) returning id`,
    [CLINIC, providerId, weekday, starts, ends, label],
  );
  return rows[0]!.id;
}

/** The provider's breaks as stored: [weekday, starts, ends, label], by weekday and start. */
async function storedBreaks(providerId: string): Promise<[number, string, string, string][]> {
  const { rows } = await db.query<{ weekday: number; starts: string; ends: string; label: string }>(
    `select weekday, starts::text, ends::text, label from provider_breaks
      where clinic_id = $1 and provider_id = $2 order by weekday, starts`,
    [CLINIC, providerId],
  );
  return rows.map((row) => [row.weekday, row.starts.slice(0, 5), row.ends.slice(0, 5), row.label]);
}

/** How many audit rows of this action are about these breaks (they are gone: their ids are kept). */
async function audited(action: string, breakIds: readonly string[]): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log
      where clinic_id = $1 and action = $2 and entity_id = any($3::text[])`,
    [CLINIC, action, breakIds],
  );
  return rows[0]?.n ?? 0;
}

/** The ids of the provider's breaks as stored, by weekday and start. */
async function breakIds(providerId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select id from provider_breaks where clinic_id = $1 and provider_id = $2
      order by weekday, starts`,
    [CLINIC, providerId],
  );
  return rows.map((row) => row.id);
}

async function chooseClinic(page: Page): Promise<void> {
  await page.goto(`${APP}/choose-clinic`);
  await page.getByRole('button', { name: CLINIC_NAME }).click();
  await expect(page).toHaveURL(`${APP}/`);
}

/**
 * Settings → Providers, once the page's script runs: the Clinic tab's Save is disabled until then
 * (StaffForm, D-076), and a tab clicked before would not open.
 */
async function openTab(page: Page): Promise<void> {
  await page.goto(`${APP}/settings`);
  await expect(
    page.getByRole('button', { name: messages.settings.clinic.save, exact: true }),
  ).toBeEnabled();
  await page.getByRole('tab', { name: t.tab }).click();
  await expect(page.getByRole('heading', { name: t.heading, exact: true })).toBeVisible();
}

/** A provider's row: a group named by the provider. */
const providerRow = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

/** The provider's Breaks dialog, open: its button pressed once the tab's script runs. */
async function openBreaks(page: Page, name: string): Promise<Locator> {
  await providerRow(page, name).getByRole('button', { name: t.breaks, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t.breaksTitle.replace('{name}', name) });
  await expect(dialog).toBeVisible();
  // The dialog drops a pointer's press for half a second after it opens (E01-T05c).
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return dialog;
}

/**
 * The dialog's add form.  is matched inside the form, so it names the button from the page: a
 * locator that starts at the dialog would look for a dialog inside the form and never find one.
 */
const addForm = (dialog: Locator) =>
  dialog
    .locator('form')
    .filter({ has: dialog.page().getByRole('button', { name: t.breakAdd, exact: true }) });

/** Fills and sends the add form; the times are the selects' values. */
async function addBreakIn(
  dialog: Locator,
  fields: { weekday: number; starts: string; ends: string; label: string },
): Promise<void> {
  const form = addForm(dialog);
  await form.getByLabel(t.breakWeekday, { exact: true }).selectOption(String(fields.weekday));
  await form.getByLabel(t.breakStarts, { exact: true }).selectOption(fields.starts);
  await form.getByLabel(t.breakEnds, { exact: true }).selectOption(fields.ends);
  await form.getByLabel(t.breakLabel, { exact: true }).fill(fields.label);
  await form.getByRole('button', { name: t.breakAdd, exact: true }).click();
}

/** One break's row in the dialog: a group named by its weekday, times and label. */
const breakRow = (dialog: Locator, group: string) => dialog.getByRole('group', { name: group });

/** The calendar on the day, once React has hydrated New appointment and the page has settled. */
async function openCalendar(page: Page, day: string): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const button = page.getByRole('button', { name: booking.open, exact: true });
  await expect
    .poll(() =>
      button.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

/**
 * Closes the dialog with Escape once the add's toast is gone: the toast is one of Radix's layers, as the
 * dialog is, and until it has gone the Escape is its own and the dialog stays open (booking.spec.ts,
 * closeToast; @radix-ui/react-dismissable-layer 1.1.19).
 */
async function closeWithEscape(page: Page, dialog: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'Notifications (F8)' }).getByRole('listitem'),
    'no toast up when the dialog closes',
  ).toHaveCount(0);
  if (await dialog.isVisible()) await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** The server actions the page sends from now on. */
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

test.describe("the providers' weekly breaks in Settings (E01-T09e)", () => {
  test.use({ storageState: OWNER_SESSION });

  test('a break added in the dialog is hatched on the calendar and warned about in the drawer; removed, it is gone from both (acceptance 1)', async ({
    page,
  }, testInfo) => {
    const { day, weekday } = dayOf(testInfo);
    const browser = testInfo.project.name;
    const prefix = `Brk ${browser} `;
    const name = `${prefix}Mira Testova`;
    const shortName = `B-${browser.slice(0, 3)}`;
    const treatment = `${prefix}check`;
    const label = `${prefix}Tea`;
    const group = `${WEEKDAY_NAMES[weekday - 1]}, 12:00–13:00, ${label}`;
    await removeOwn(prefix);
    const providerId = await addProvider(name, shortName);
    await addType(treatment);
    try {
      await chooseClinic(page);
      await openTab(page);
      const dialog = await openBreaks(page, name);
      await expect(dialog.getByText(t.breaksNone, { exact: true })).toBeVisible();
      await addBreakIn(dialog, { weekday, starts: '12:00', ends: '13:00', label });
      await expect(breakRow(dialog, group)).toBeVisible();
      await expect(page.getByText(t.breakAdded, { exact: true }).first()).toBeVisible();
      expect(await storedBreaks(providerId)).toEqual([[weekday, '12:00', '13:00', label]]);
      // The add form is empty again and the keyboard is at its weekday, for the next one.
      const form = addForm(dialog);
      await expect(form.getByLabel(t.breakLabel, { exact: true })).toHaveValue('');
      await expect(form.getByLabel(t.breakWeekday, { exact: true })).toBeFocused();
      await closeWithEscape(page, dialog);

      // Hatched in the provider's column on that weekday.
      await openCalendar(page, day);
      const column = page.getByRole('list', { name, exact: true });
      await expect(column.locator('li[data-break]')).toHaveCount(1);
      await expect(column.locator('li[data-break]')).toContainText(label);

      // Warned about in the drawer: a time in it says so, a time before it does not.
      const warning = `Overlaps ${shortName}'s break: ${label}, 12:00–13:00.`;
      const warnedIn = async (start: string): Promise<Locator> => {
        await page.getByRole('button', { name: booking.open, exact: true }).click();
        const drawer = page.getByRole('dialog', { name: booking.title });
        await expect(drawer).toBeVisible();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
        const patient = drawer.getByRole('combobox', { name: booking.patient });
        await patient.fill('Бојан Њи');
        await drawer
          .getByRole('listbox', { name: booking.suggestions })
          .getByRole('option')
          .filter({ hasText: 'Бојан Њивовски' })
          .click();
        await drawer.getByRole('button', { name: treatment, exact: true }).click();
        await drawer
          .getByLabel(booking.provider, { exact: true })
          .selectOption({ label: shortName });
        await drawer.getByLabel(booking.start, { exact: true }).selectOption(start);
        return drawer;
      };
      let drawer = await warnedIn('11:00');
      await expect(drawer.getByText(warning, { exact: true })).toBeHidden();
      await drawer.getByLabel(booking.start, { exact: true }).selectOption('12:15');
      await expect(drawer.getByText(warning, { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();

      // Removed: gone from the dialog, the calendar and the drawer. The keyboard is at the heading.
      await openTab(page);
      const again = await openBreaks(page, name);
      await breakRow(again, group)
        .getByRole('button', { name: t.breakRemove, exact: true })
        .click();
      await expect(page.getByText(t.breakRemoved, { exact: true }).first()).toBeVisible();
      await expect(again.getByText(t.breaksNone, { exact: true })).toBeVisible();
      await expect(
        again.getByRole('heading', { name: t.breaksHeading, exact: true }),
      ).toBeFocused();
      expect(await storedBreaks(providerId)).toEqual([]);
      await openCalendar(page, day);
      await expect(
        page.getByRole('list', { name, exact: true }).locator('li[data-break]'),
      ).toHaveCount(0);
      drawer = await warnedIn('12:15');
      await expect(drawer.getByText(warning, { exact: true })).toBeHidden();
    } finally {
      await removeOwn(prefix);
    }
  });

  test('a break overlapping another of the provider that weekday is refused above the button and nothing is added; back to back is added (acceptance 2)', async ({
    page,
  }, testInfo) => {
    const { weekday } = dayOf(testInfo);
    const browser = testInfo.project.name;
    const prefix = `Brk2 ${browser} `;
    const name = `${prefix}Ana Probna`;
    await removeOwn(prefix);
    const providerId = await addProvider(name, `C-${browser.slice(0, 3)}`);
    try {
      await addStoredBreak(providerId, weekday, '12:00', '13:00', 'Lunch');
      await chooseClinic(page);
      await openTab(page);
      const dialog = await openBreaks(page, name);
      const overlapped = dialog.getByText(t.breakOverlaps, { exact: true });
      await addBreakIn(dialog, { weekday, starts: '12:30', ends: '13:30', label: 'Other' });
      await expect(overlapped).toBeVisible();
      expect(await storedBreaks(providerId)).toEqual([[weekday, '12:00', '13:00', 'Lunch']]);
      // Back to back, before and after: added, the refusal gone with the form mounted anew.
      await addBreakIn(dialog, { weekday, starts: '13:00', ends: '14:00', label: 'After' });
      await expect(
        breakRow(dialog, `${WEEKDAY_NAMES[weekday - 1]}, 13:00–14:00, After`),
      ).toBeVisible();
      await expect(overlapped).toBeHidden();
      await addBreakIn(dialog, { weekday, starts: '11:00', ends: '12:00', label: 'Before' });
      await expect(
        breakRow(dialog, `${WEEKDAY_NAMES[weekday - 1]}, 11:00–12:00, Before`),
      ).toBeVisible();
      expect(await storedBreaks(providerId)).toEqual([
        [weekday, '11:00', '12:00', 'Before'],
        [weekday, '12:00', '13:00', 'Lunch'],
        [weekday, '13:00', '14:00', 'After'],
      ]);
      // An end not after the start is the field's own problem, and nothing is added.
      await addBreakIn(dialog, { weekday, starts: '15:00', ends: '15:00', label: 'Empty' });
      await expect(
        dialog.getByText(messages.form.fieldErrors.other, { exact: true }),
      ).toBeVisible();
      expect(await storedBreaks(providerId)).toHaveLength(3);
    } finally {
      await removeOwn(prefix);
    }
  });

  // Acceptance 4 (`message`): a Remove's row leaves and the next break's Remove moves up under the
  // resting pointer once the first click's answer is back, so a second press would remove that break
  // too; the dialog's list takes no pointer click for a moment after its rows change (SETTLE_MS).
  for (const gap of [80, 150, 250]) {
    test(`a double click on a break's Remove, ${gap} ms between the clicks, removes one break, once (acceptance 4)`, async ({
      page,
    }, testInfo) => {
      const { weekday } = dayOf(testInfo);
      const browser = testInfo.project.name;
      const prefix = `Brk3 ${browser} ${gap} `;
      const name = `${prefix}Vera Vzorec`;
      await removeOwn(prefix);
      const providerId = await addProvider(name, `D-${browser.slice(0, 3)}${gap}`);
      await addStoredBreak(providerId, weekday, '09:00', '09:30', 'First');
      await addStoredBreak(providerId, weekday, '10:00', '10:30', 'Second');
      await addStoredBreak(providerId, weekday, '11:00', '11:30', 'Third');
      const ids = await breakIds(providerId);
      try {
        // Taller than the page: nothing scrolls.
        await page.setViewportSize({ width: 1280, height: 2400 });
        await chooseClinic(page);
        await openTab(page);
        const dialog = await openBreaks(page, name);
        const day = WEEKDAY_NAMES[weekday - 1];
        const button = breakRow(dialog, `${day}, 09:00–09:30, First`).getByRole('button', {
          name: t.breakRemove,
          exact: true,
        });
        // Let the list take the pointer: Playwright's trial hover waits until it would.
        await button.hover({ trial: true });
        const box = await button.boundingBox();
        if (!box) throw new Error('The button has no box.');
        const spot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const sent = actionsSent(page);
        await page.mouse.click(spot.x, spot.y);
        await page.waitForTimeout(gap);
        await page.mouse.click(spot.x, spot.y);
        // Past the moment the list takes no click: a second action would have been sent by now.
        await page.waitForTimeout(1_200);
        await sent.answered();
        expect(sent.count(), 'actions sent for one double click').toBe(1);
        expect(await storedBreaks(providerId)).toEqual([
          [weekday, '10:00', '10:30', 'Second'],
          [weekday, '11:00', '11:30', 'Third'],
        ]);
        expect(await audited('provider.break_removed', ids)).toBe(1);
      } finally {
        await removeOwn(prefix);
      }
    });
  }
});
