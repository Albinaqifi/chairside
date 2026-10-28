import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T09b in real browsers, on the production build, as the seeded owner (the global setup's
// session; no sign-in of its own), in the second seeded clinic: the first clinic's three providers are
// the columns booking.spec.ts and calendar.spec.ts count, so nothing here touches them, even for a
// moment. Acceptance 1: a provider added on the tab is a column on the calendar and a choice in the
// booking drawer, and books. Acceptance 3 (the browser's side): the colour range, moved, is the hue
// the form sends, and the tints beside it follow it. Each browser's provider, its treatment type (the
// clinic keeps no catalogue, and a booking takes one) and its visit carry the browser's name, so the
// three browsers never meet on a row; each removes what it wrote. Names are invented; the patient is
// the seed's.

const t = messages.settings.providers;
const booking = messages.calendar.booking;

/** The clinic the check runs in, as the clinic picker names it. */
const CLINIC_NAME = 'Забна клиника Сончоглед';
const CLINIC = SEEDED_CLINICS.soncogled;

/** The day each browser books on: a weekday, open 08:00–18:00, far from every other check's days. */
const DAYS: Record<string, string> = {
  chromium: '2031-09-08',
  firefox: '2031-09-09',
  webkit: '2031-09-10',
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

/**
 * Removes the clinic's providers and treatment types whose names start with `prefix`, the visits
 * booked with them. The audit rows stay, ids alone: the log is never cleaned.
 */
async function removeOwn(prefix: string): Promise<void> {
  await db.query(
    `delete from appointments where clinic_id = $1 and (
       provider_id in (select id from providers where clinic_id = $1 and starts_with(name, $2))
       or treatment_type_id in
         (select id from treatment_types where clinic_id = $1 and starts_with(name, $2)))`,
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

/** Writes an active treatment type of this name, 30 minutes, as the migration role. */
async function addType(name: string): Promise<void> {
  await db.query(
    `insert into treatment_types (id, clinic_id, name, default_duration_min)
     values (gen_random_uuid(), $1, $2, 30)`,
    [CLINIC, name],
  );
}

/** The provider of this name as stored: its kind, chair, hue and order, and whether it is active. */
async function storedProvider(name: string) {
  const { rows } = await db.query<{
    id: string;
    short_name: string;
    kind: string;
    chair_label: string;
    color_hue: number;
    active: boolean;
    sort_order: number;
  }>(
    `select id, short_name, kind, chair_label, color_hue, active, sort_order
       from providers where clinic_id = $1 and name = $2`,
    [CLINIC, name],
  );
  return rows;
}

/** The clinic's visits on the day: each one's title and its provider's name. */
async function bookedOn(day: string): Promise<{ title: string; provider: string }[]> {
  const { rows } = await db.query<{ title: string; provider: string }>(
    `select a.title, p.name as provider
       from appointments a join providers p on p.id = a.provider_id
      where a.clinic_id = $1 and (a.starts_at at time zone 'Europe/Skopje')::date = $2::date
      order by a.starts_at`,
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

/** The hue an element sets as --provider-hue, which the theme's tints read. */
async function hueOf(element: Locator): Promise<string> {
  return element.evaluate((node) => (node as HTMLElement).style.getPropertyValue('--provider-hue'));
}

/** The colour an element of the preview is painted in, as the browser computed it. */
async function backgroundOf(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).backgroundColor);
}

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

test.describe('providers in Settings (E01-T09b)', () => {
  test.use({ storageState: OWNER_SESSION });

  test('a provider added on the tab, its colour moved, is a column on the calendar and a choice in the drawer, and books (acceptance 1, 3)', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo);
    const browser = testInfo.project.name;
    const prefix = `Prov ${browser} `;
    const name = `${prefix}Mira Testova`;
    const shortName = `P-${browser.slice(0, 3)}`;
    const treatment = `${prefix}check`;
    await removeOwn(prefix);
    await addType(treatment);
    try {
      await chooseClinic(page);
      await openTab(page);
      const add = page.locator('form').filter({ has: page.getByRole('button', { name: t.add }) });
      await add.getByLabel(t.name, { exact: true }).fill(name);
      await add.getByLabel(t.shortName, { exact: true }).fill(shortName);
      await add.getByLabel(t.kind, { exact: true }).selectOption('hygienist');
      await add.getByLabel(t.chair, { exact: true }).fill('Hygiene room');

      // The colour: the range at the theme's hue, its tints beside it; moved, the tints follow.
      const range = add.getByLabel(t.colour, { exact: true });
      const preview = add.locator('[data-slot="colour-preview"]');
      const swatch = preview.locator('[data-slot="provider-swatch"]');
      await expect(range).toHaveValue('200');
      expect(await hueOf(preview)).toBe('200');
      const before = await backgroundOf(swatch);
      await range.fill('310');
      await expect(range).toHaveValue('310');
      await expect.poll(() => hueOf(preview)).toBe('310');
      expect(await backgroundOf(swatch)).not.toBe(before);
      // The keyboard moves it too, a degree a press.
      await range.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect(range).toHaveValue('312');
      await expect.poll(() => hueOf(preview)).toBe('312');

      await add.getByRole('button', { name: t.add, exact: true }).click();
      const row = page.getByRole('listitem').filter({ hasText: name });
      await expect(row).toContainText(`${shortName} · Hygienist · Hygiene room`);
      expect(await hueOf(row.locator('[data-slot="provider-swatch"]'))).toBe('312');
      // The add form empty again, its colour back at the first hue, its name the keyboard's place.
      await expect(add.getByLabel(t.name, { exact: true })).toHaveValue('');
      await expect(add.getByLabel(t.name, { exact: true })).toBeFocused();
      await expect(add.getByLabel(t.colour, { exact: true })).toHaveValue('200');
      const [stored] = await storedProvider(name);
      expect(stored).toMatchObject({
        short_name: shortName,
        kind: 'hygienist',
        chair_label: 'Hygiene room',
        color_hue: 312,
        active: true,
      });
      // After the seeded dentist (1), and after another browser's provider if it was added first.
      expect(stored!.sort_order).toBeGreaterThanOrEqual(2);

      // A column on the calendar, in its colour.
      await openCalendar(page, day);
      await expect(page.getByRole('list', { name, exact: true })).toBeVisible();

      // A choice in the drawer, and it books.
      await page.getByRole('button', { name: booking.open, exact: true }).click();
      const drawer = page.getByRole('dialog', { name: booking.title });
      await expect(drawer).toBeVisible();
      // The drawer drops a pointer's press for half a second after it opens (E01-T05c).
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      const patient = drawer.getByRole('combobox', { name: booking.patient });
      await patient.fill('Бојан Њи');
      await drawer
        .getByRole('listbox', { name: booking.suggestions })
        .getByRole('option')
        .filter({ hasText: 'Бојан Њивовски' })
        .click();
      await expect(patient).toHaveValue('Бојан Њивовски');
      await drawer.getByRole('button', { name: treatment, exact: true }).click();
      await drawer.getByLabel(booking.provider, { exact: true }).selectOption({ label: shortName });
      await drawer.getByRole('button', { name: new RegExp(`^Book .* with ${shortName}$`) }).click();
      await expect(drawer).toBeHidden();
      expect(await bookedOn(day)).toEqual([{ title: treatment, provider: name }]);
      await expect(page.getByRole('list', { name, exact: true })).toContainText(treatment);
    } finally {
      await removeOwn(prefix);
    }
  });
});
