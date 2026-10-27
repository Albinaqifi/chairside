import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T09a in real browsers, on the production build, as the seeded owner (the global setup's
// session; no sign-in of its own), in the second seeded clinic, which has no treatment types: the
// first clinic's ten are what booking.spec.ts counts and books with, so nothing here touches them.
// Acceptance 1: a type added on the tab is offered in the booking drawer with its length and books;
// made inactive, it is offered no more. Acceptance 2: a double click on a row's Make inactive, its two
// clicks 80, 150 and 250 ms apart, makes that one type inactive, once. Each check's types and visits
// carry its browser's name, so the three browsers never meet on a row; each removes what it wrote.
// Names are invented; the patient is the seed's.

const t = messages.settings.treatmentTypes;
const booking = messages.calendar.booking;

/** The clinic the checks run in, as the clinic picker names it. */
const CLINIC_NAME = 'Забна клиника Сончоглед';
const CLINIC = SEEDED_CLINICS.soncogled;

/** The day each browser books on: a weekday, open 08:00–18:00, far from every other check's days. */
const DAYS: Record<string, string> = {
  chromium: '2031-08-04',
  firefox: '2031-08-05',
  webkit: '2031-08-06',
};

function dayOf(testInfo: TestInfo): string {
  const day = DAYS[testInfo.project.name];
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

/** Removes the clinic's types whose names start with `prefix`, and the visits booked with them. */
async function removeTypes(prefix: string): Promise<void> {
  await db.query(
    `delete from appointments where clinic_id = $1 and treatment_type_id in
       (select id from treatment_types where clinic_id = $1 and starts_with(name, $2))`,
    [CLINIC, prefix],
  );
  await db.query(`delete from treatment_types where clinic_id = $1 and starts_with(name, $2)`, [
    CLINIC,
    prefix,
  ]);
}

/** Writes active types of these names, 30 minutes each, as the migration role. */
async function addTypes(names: readonly string[]): Promise<void> {
  await db.query(
    `insert into treatment_types (id, clinic_id, name, default_duration_min)
     select gen_random_uuid(), $1, name, 30 from unnest($2::text[]) as name`,
    [CLINIC, names],
  );
}

/** Whether each of these types is active now, by name. */
async function activeByName(names: readonly string[]): Promise<Record<string, boolean>> {
  const { rows } = await db.query<{ name: string; active: boolean }>(
    `select name, active from treatment_types where clinic_id = $1 and name = any($2::text[])`,
    [CLINIC, names],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.active]));
}

/** The treatment_type.deactivated audit rows about the type of this name. */
async function deactivations(name: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log a join treatment_types tt on tt.id::text = a.entity_id
      where a.clinic_id = $1 and a.action = 'treatment_type.deactivated' and tt.name = $2`,
    [CLINIC, name],
  );
  return rows[0]?.n ?? 0;
}

/** The clinic's visits on the day: title and length in minutes. */
async function bookedOn(day: string): Promise<{ title: string; minutes: number }[]> {
  const { rows } = await db.query<{ title: string; minutes: number }>(
    `select title, (extract(epoch from ends_at - starts_at) / 60)::int as minutes
       from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date
      order by starts_at`,
    [CLINIC, day],
  );
  return rows;
}

/** Into the second seeded clinic, by its picker, as the owner does after logging in. */
async function chooseClinic(page: Page): Promise<void> {
  await page.goto(`${APP}/choose-clinic`);
  await page.getByRole('button', { name: CLINIC_NAME }).click();
  await expect(page).toHaveURL(`${APP}/`);
}

/**
 * Settings → Treatment types, once the page's script runs: the Clinic tab's Save is disabled until
 * then (StaffForm, D-076), and a tab clicked before would not open.
 */
async function openTab(page: Page): Promise<void> {
  await page.goto(`${APP}/settings`);
  await expect(
    page.getByRole('button', { name: messages.settings.clinic.save, exact: true }),
  ).toBeEnabled();
  await page.getByRole('tab', { name: t.tab }).click();
  await expect(page.getByRole('heading', { name: t.heading, exact: true })).toBeVisible();
}

/** A type's row: a group named by the type, ", inactive" for an inactive one. */
const typeRow = (page: Page, name: string, active = true) =>
  page.getByRole('group', {
    name: active ? name : t.inactiveName.replace('{name}', name),
    exact: true,
  });

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

/** Opens the booking drawer and lets its half second pass before the first press in it (E01-T05c). */
async function openDrawer(page: Page) {
  await page.getByRole('button', { name: booking.open, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: booking.title });
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return drawer;
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

test.describe('treatment types in Settings (E01-T09a)', () => {
  test.use({ storageState: OWNER_SESSION });

  test('a type added on the tab is offered in the drawer with its length and books; made inactive, it is offered no more (acceptance 1)', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo);
    const name = `Implant check ${testInfo.project.name}`;
    await removeTypes(name);
    try {
      await chooseClinic(page);
      await openTab(page);
      const add = page.locator('form').filter({ has: page.getByRole('button', { name: t.add }) });
      await add.getByLabel(t.name, { exact: true }).fill(name);
      await add.getByLabel(t.length, { exact: true }).selectOption('45');
      await add.getByLabel(t.price.replace('{currency}', 'MKD'), { exact: true }).fill('1500');
      await add.getByRole('button', { name: t.add, exact: true }).click();
      await expect(typeRow(page, name)).toContainText('45 min · MKD 1,500.00');
      // The add form empty again, its name field the keyboard's place, for the next one.
      await expect(add.getByLabel(t.name, { exact: true })).toHaveValue('');
      await expect(add.getByLabel(t.name, { exact: true })).toBeFocused();

      // Edit, in its dialog: filled with the type as it is; the length changed, aftercare ticked.
      await typeRow(page, name).getByRole('button', { name: t.edit, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: t.editTitle.replace('{name}', name) });
      await expect(dialog).toBeVisible();
      // The dialog drops a pointer's press for half a second after it opens (E01-T05c).
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      await expect(dialog.getByLabel(t.name, { exact: true })).toHaveValue(name);
      await expect(dialog.getByLabel(t.length, { exact: true })).toHaveValue('45');
      await expect(
        dialog.getByLabel(t.price.replace('{currency}', 'MKD'), { exact: true }),
      ).toHaveValue('1500');
      await dialog.getByLabel(t.length, { exact: true }).selectOption('50');
      await dialog.getByRole('checkbox', { name: t.needsAftercare }).click();
      await dialog.getByRole('button', { name: t.save, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(typeRow(page, name)).toContainText('50 min · MKD 1,500.00 · Needs aftercare');

      await openCalendar(page, day);
      let drawer = await openDrawer(page);
      const patient = drawer.getByRole('combobox', { name: booking.patient });
      await patient.fill('Стефан Ка');
      await drawer
        .getByRole('listbox', { name: booking.suggestions })
        .getByRole('option')
        .filter({ hasText: 'Стефан Каменов' })
        .click();
      await expect(patient).toHaveValue('Стефан Каменов');
      await drawer.getByRole('button', { name, exact: true }).click();
      await expect(drawer.getByLabel(booking.length, { exact: true })).toHaveValue('50');
      await drawer.getByRole('button', { name: /^Book / }).click();
      await expect(drawer).toBeHidden();
      expect(await bookedOn(day)).toEqual([{ title: name, minutes: 50 }]);

      await openTab(page);
      await typeRow(page, name).getByRole('button', { name: t.deactivate, exact: true }).click();
      await expect(typeRow(page, name, false)).toBeVisible();
      await expect(typeRow(page, name, false)).toContainText(t.inactive);

      await openCalendar(page, day);
      drawer = await openDrawer(page);
      await expect(
        drawer.getByRole('group', { name: booking.treatment }).getByRole('button', { name }),
      ).toHaveCount(0);
      // The visit booked with it keeps its title.
      expect(await bookedOn(day)).toEqual([{ title: name, minutes: 50 }]);
    } finally {
      await removeTypes(name);
    }
  });

  // Acceptance 2 (`message`): a type made inactive moves to the inactive ones at the list's end, so
  // the next type's Make inactive comes under the resting pointer once the first click's answer is
  // back; the list takes no pointer click for a moment after its rows change (SETTLE_MS).
  for (const gap of [80, 150, 250]) {
    test(`a double click on a row's Make inactive, ${gap} ms between the clicks, makes that one type inactive, once (acceptance 2)`, async ({
      page,
    }, testInfo) => {
      const prefix = `Double ${testInfo.project.name} ${gap} `;
      const names = [`${prefix}A`, `${prefix}B`, `${prefix}C`];
      const [target] = names as [string];
      await removeTypes(prefix);
      await addTypes(names);
      try {
        // Taller than the page: nothing scrolls, so the rows under the moved one move up.
        await page.setViewportSize({ width: 1280, height: 2400 });
        await chooseClinic(page);
        await openTab(page);
        const button = typeRow(page, target).getByRole('button', {
          name: t.deactivate,
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
        await expect(typeRow(page, target, false)).toBeVisible();
        // Past the moment the list takes no click: a second action would have been sent by now.
        await page.waitForTimeout(1_200);
        await sent.answered();
        expect(sent.count(), 'actions sent for one double click').toBe(1);
        expect(await activeByName(names)).toEqual({
          [`${prefix}A`]: false,
          [`${prefix}B`]: true,
          [`${prefix}C`]: true,
        });
        expect(await deactivations(target)).toBe(1);
      } finally {
        await removeTypes(prefix);
      }
    });
  }
});
