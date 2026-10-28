import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T09d in real browsers, on the production build, as the seeded owner (the global setup's
// session; no sign-in of its own). Acceptance 1 and 3: a provider changed on the tab shows on the
// calendar's column and in the drawer; made inactive, the toast names its visit ahead, it is no column
// on a day without their visits and no choice in the drawer, its visit still on the calendar; made
// active again, all of it back. Acceptance 4: a double click on a row's Make inactive, its two clicks
// 80, 150 and 250 ms apart, changes that one provider, once. These run in the second seeded clinic, on
// providers they write themselves, far down the order (sort_order 100 and on), so the seeded dentist
// stays the drawer's first choice for treatment-types.spec.ts; the first clinic's providers are the
// columns booking.spec.ts and calendar.spec.ts count, so nothing here changes them, even for a
// moment. Acceptance 2: the Edit of the first clinic's seeded dentist, linked to a login, shows the
// kind locked: opened and closed, nothing saved. Each browser's rows carry its name, so the three
// browsers never meet on a row; each removes what it wrote. Names are invented; the patient is the
// seed's.

const t = messages.settings.providers;
const booking = messages.calendar.booking;

const SONCOGLED_NAME = 'Забна клиника Сончоглед';
const SONCOGLED = SEEDED_CLINICS.soncogled;
const HARBOUR_STREET_NAME = 'Harbour Street Dental';
/** Harbour Street's first dentist, linked to the seeded dentist's login. */
const LINKED_DENTIST = { id: SEEDED_PROVIDERS.harbourStreetDentist, name: 'Elena Planinska' };

/** Each browser's days: its provider's visit on the first, nothing of theirs on the second. */
const DAYS: Record<string, { visit: string; empty: string }> = {
  chromium: { visit: '2031-10-06', empty: '2031-10-13' },
  firefox: { visit: '2031-10-07', empty: '2031-10-14' },
  webkit: { visit: '2031-10-08', empty: '2031-10-15' },
};

function daysOf(testInfo: TestInfo): { visit: string; empty: string } {
  const days = DAYS[testInfo.project.name];
  if (!days) throw new Error(`No days for the browser ${testInfo.project.name}.`);
  return days;
}

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

/**
 * Removes the second clinic's providers whose names start with `prefix`, and their visits. The audit
 * rows stay, ids alone: the log is never cleaned.
 */
async function removeOwn(prefix: string): Promise<void> {
  await db.query(
    `delete from appointments where clinic_id = $1 and provider_id in
       (select id from providers where clinic_id = $1 and starts_with(name, $2))`,
    [SONCOGLED, prefix],
  );
  await db.query(`delete from providers where clinic_id = $1 and starts_with(name, $2)`, [
    SONCOGLED,
    prefix,
  ]);
}

/** Writes active dentists of these names in the second clinic, after the seed's, as the migration role. */
async function addProviders(names: readonly string[]): Promise<void> {
  await db.query(
    `insert into providers (id, clinic_id, name, short_name, kind, chair_label, color_hue, sort_order)
     select gen_random_uuid(), $1, name, left(name, 12), 'dentist', 'Chair 8', 40, 100 + ord
       from unnest($2::text[]) with ordinality as each(name, ord)`,
    [SONCOGLED, names],
  );
}

/**
 * Books a visit of the clinic's first patient with the provider of this name at 10:00 on the day, in
 * the clinic's zone, as the migration role.
 */
async function addVisit(providerName: string, day: string): Promise<void> {
  await db.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               source, created_by)
     select gen_random_uuid(), $1,
            (select id from patients where clinic_id = $1 order by id limit 1),
            p.id, 'Checkup', ($3::date + time '10:00') at time zone 'Europe/Skopje',
            ($3::date + time '10:30') at time zone 'Europe/Skopje', 'staff',
            (select user_id from memberships where clinic_id = $1 order by user_id limit 1)
       from providers p where p.clinic_id = $1 and p.name = $2`,
    [SONCOGLED, providerName, day],
  );
}

/** Whether each of these providers is active now, by name. */
async function activeByName(names: readonly string[]): Promise<Record<string, boolean>> {
  const { rows } = await db.query<{ name: string; active: boolean }>(
    `select name, active from providers where clinic_id = $1 and name = any($2::text[])`,
    [SONCOGLED, names],
  );
  return Object.fromEntries(rows.map((row) => [row.name, row.active]));
}

/** The audit rows of this action about the second clinic's provider of this name. */
async function audited(action: string, name: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log a join providers p on p.id::text = a.entity_id
      where a.clinic_id = $1 and a.action = $2 and p.name = $3`,
    [SONCOGLED, action, name],
  );
  return rows[0]?.n ?? 0;
}

/** Into a seeded clinic, by its picker, as the owner does after logging in. */
async function chooseClinic(page: Page, name: string): Promise<void> {
  await page.goto(`${APP}/choose-clinic`);
  await page.getByRole('button', { name }).click();
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

/** A provider's row: a group named by the provider, ", inactive" for an inactive one. */
const providerRow = (page: Page, name: string, active = true) =>
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

/** The booking drawer's provider choices, by their short names, then the drawer closed. */
async function drawerChoices(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: booking.open, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: booking.title });
  await expect(drawer).toBeVisible();
  const choices = await drawer
    .getByLabel(booking.provider, { exact: true })
    .locator('option')
    .allTextContents();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  return choices;
}

/** Opens a row's Edit and lets its half second pass before the first press in it (E01-T05c). */
async function openEdit(page: Page, name: string, active = true) {
  await providerRow(page, name, active).getByRole('button', { name: t.edit, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t.editTitle.replace('{name}', name) });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return dialog;
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

test.describe('changing a provider in Settings (E01-T09d)', () => {
  test.use({ storageState: OWNER_SESSION });

  test('changed, it shows on the calendar and in the drawer; made inactive, the toast names its visit ahead, no column on an empty day, no choice, its visit kept; made active again, all back (acceptance 1, 3)', async ({
    page,
  }, testInfo) => {
    const days = daysOf(testInfo);
    const browser = testInfo.project.name;
    const prefix = `Edit ${browser} `;
    const first = `${prefix}Mira Testova`;
    const name = `${prefix}Ana Probna`;
    const shortName = `E-${browser.slice(0, 3)}`;
    await removeOwn(prefix);
    await addProviders([first]);
    await addVisit(first, days.visit);
    try {
      await chooseClinic(page, SONCOGLED_NAME);
      await openTab(page);

      // Edit, in its dialog: filled with the provider as it is; every field changed.
      const dialog = await openEdit(page, first);
      await expect(dialog.getByLabel(t.name, { exact: true })).toHaveValue(first);
      await expect(dialog.getByLabel(t.kind, { exact: true })).toHaveValue('dentist');
      await expect(dialog.getByLabel(t.kind, { exact: true })).toBeEnabled();
      await expect(dialog.getByLabel(t.colour, { exact: true })).toHaveValue('40');
      await dialog.getByLabel(t.name, { exact: true }).fill(name);
      await dialog.getByLabel(t.shortName, { exact: true }).fill(shortName);
      await dialog.getByLabel(t.kind, { exact: true }).selectOption('other');
      await dialog.getByLabel(t.chair, { exact: true }).fill('Chair 6');
      await dialog.getByLabel(t.colour, { exact: true }).fill('280');
      await dialog.getByRole('button', { name: t.save, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(t.saved, { exact: true })).toBeVisible();
      await expect(providerRow(page, name)).toContainText(`${shortName} · Other · Chair 6`);

      // On the calendar, its column by the new name, its visit in it; in the drawer, the new short name.
      await openCalendar(page, days.visit);
      await expect(page.getByRole('list', { name, exact: true })).toContainText('Checkup');
      expect(await drawerChoices(page)).toContain(shortName);

      // Made inactive: the toast says its visit ahead stays booked; the keyboard at the heading.
      await openTab(page);
      await providerRow(page, name)
        .getByRole('button', { name: t.deactivate, exact: true })
        .click();
      await expect(providerRow(page, name, false)).toContainText(t.inactive);
      await expect(
        page.getByText('Provider made inactive. 1 visit ahead stays booked with them.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: t.heading, exact: true })).toBeFocused();

      // No column on a day without their visits, no choice in the drawer; on their visit's day, the
      // column with the visit still booked.
      await openCalendar(page, days.empty);
      await expect(page.getByRole('list', { name, exact: true })).toHaveCount(0);
      expect(await drawerChoices(page)).not.toContain(shortName);
      await openCalendar(page, days.visit);
      await expect(page.getByRole('list', { name, exact: true })).toContainText('Checkup');
      expect(await drawerChoices(page)).not.toContain(shortName);

      // Made active again: all of it back.
      await openTab(page);
      await providerRow(page, name, false)
        .getByRole('button', { name: t.activate, exact: true })
        .click();
      await expect(providerRow(page, name)).toBeVisible();
      await expect(page.getByText(t.activated, { exact: true })).toBeVisible();
      await openCalendar(page, days.empty);
      await expect(page.getByRole('list', { name, exact: true })).toBeVisible();
      expect(await drawerChoices(page)).toContain(shortName);
      expect(await audited('provider.updated', name)).toBe(1);
      expect(await audited('provider.deactivated', name)).toBe(1);
      expect(await audited('provider.activated', name)).toBe(1);
    } finally {
      await removeOwn(prefix);
    }
  });

  test('the Edit of a provider linked to a login shows the kind locked and says why; closed, nothing saved (acceptance 2)', async ({
    page,
  }) => {
    const stored = async () =>
      (
        await db.query<{ kind: string; updated_at: Date; audited: number }>(
          `select kind, updated_at,
                  (select count(*)::int from audit_log
                    where entity_id = $2 and action = 'provider.updated') as audited
             from providers where id = $1`,
          [LINKED_DENTIST.id, LINKED_DENTIST.id],
        )
      ).rows[0];
    const before = await stored();
    await chooseClinic(page, HARBOUR_STREET_NAME);
    await openTab(page);
    const dialog = await openEdit(page, LINKED_DENTIST.name);
    const kind = dialog.getByLabel(t.kind, { exact: true });
    await expect(kind).toBeDisabled();
    await expect(kind).toHaveValue('dentist');
    await expect(dialog.getByText(t.kindLocked, { exact: true })).toBeVisible();
    await expect(kind).toHaveAccessibleDescription(t.kindLocked);
    // The other fields stay open to change.
    await expect(dialog.getByLabel(t.name, { exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await stored()).toEqual(before);
  });

  // Acceptance 4 (`message`): a provider's row does not move when it is made inactive, but its Make
  // inactive turns into Make active under the resting pointer once the first click's answer is back;
  // the list takes no pointer click for a moment after its rows change (SETTLE_MS).
  for (const gap of [80, 150, 250]) {
    test(`a double click on a row's Make inactive, ${gap} ms between the clicks, changes that one provider, once (acceptance 4)`, async ({
      page,
    }, testInfo) => {
      const prefix = `Double ${testInfo.project.name} ${gap} `;
      const names = [`${prefix}A`, `${prefix}B`, `${prefix}C`];
      const [target] = names as [string];
      await removeOwn(prefix);
      await addProviders(names);
      try {
        // Taller than the page: nothing scrolls.
        await page.setViewportSize({ width: 1280, height: 2400 });
        await chooseClinic(page, SONCOGLED_NAME);
        await openTab(page);
        const button = providerRow(page, target).getByRole('button', {
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
        await expect(providerRow(page, target, false)).toBeVisible();
        // Past the moment the list takes no click: a second action would have been sent by now.
        await page.waitForTimeout(1_200);
        await sent.answered();
        expect(sent.count(), 'actions sent for one double click').toBe(1);
        expect(await activeByName(names)).toEqual({
          [`${prefix}A`]: false,
          [`${prefix}B`]: true,
          [`${prefix}C`]: true,
        });
        expect(await audited('provider.deactivated', target)).toBe(1);
        expect(await audited('provider.activated', target)).toBe(0);
      } finally {
        await removeOwn(prefix);
      }
    });
  }
});
