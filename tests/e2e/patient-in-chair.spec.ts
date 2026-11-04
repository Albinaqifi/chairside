import { expect, test, type Locator, type Page } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T06d in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): a patient marked "In the chair" in the calendar's drawer reads
// "In the chair now" on the patient list and on the profile; marked Done, both read as they did
// before (the visit is history, no appointment ahead). Both pages are reached by a fresh load and by
// Back, to a page the browser's router had already shown before the change: the pages are visited by
// the app's own client navigation (the list, the profile, then the calendar's day), so Back goes
// through the router's cache, not the server. Each browser works on a day of its own in March 2039, a
// year no other spec uses (the years in use are 2026 and 2032 to 2038), with a patient it adds and
// removes, written as the migration role, as appointment-restore.spec.ts writes its rows. The names
// are invented; the assertions on the database name ids and statuses only.

const profile = messages.patientProfile;
const list = messages.patients;
const status = messages.appointmentStatus;

/** Each browser's day (a Tuesday, Wednesday and Thursday) and the last name of its patient. */
const OWN: Record<string, { day: string; last: string }> = {
  chromium: { day: '2039-03-01', last: 'Aachromium' },
  firefox: { day: '2039-03-02', last: 'Aafirefox' },
  webkit: { day: '2039-03-03', last: 'Aawebkit' },
};
// A last name that sorts first, so the patient is among the list's first rows however many the
// other specs added.
const FIRST = 'Chair';

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

/** The patient of a browser, with a booked visit at 10:00 of its day, written as the migration role. */
async function writePatientWithVisit(day: string, last: string): Promise<string> {
  await db.query(
    `insert into patients (id, clinic_id, first_name, last_name, language)
     values (gen_random_uuid(), $1, $2, $3, 'en')`,
    [SEEDED_CLINICS.harbourStreet, FIRST, last],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + time '10:00') at time zone 'Europe/Skopje',
            ($2::date + time '10:30') at time zone 'Europe/Skopje',
            'booked', 'staff', $5
       from patients p
      where p.clinic_id = $1 and p.first_name = $6 and p.last_name = $3
     returning patient_id as id`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      last,
      SEEDED_PROVIDERS.harbourStreetDentist,
      SEEDED_PEOPLE.frontDesk.id,
      FIRST,
    ],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error('One patient was written.');
  return rows[0].id;
}

async function remove(last: string): Promise<void> {
  await db.query(
    `delete from appointments where patient_id in
       (select id from patients where clinic_id = $1 and last_name = $2)`,
    [SEEDED_CLINICS.harbourStreet, last],
  );
  await db.query(`delete from patients where clinic_id = $1 and last_name = $2`, [
    SEEDED_CLINICS.harbourStreet,
    last,
  ]);
}

async function statusOfVisit(patientId: string): Promise<string[]> {
  const { rows } = await db.query<{ status: string }>(
    'select status from appointments where patient_id = $1',
    [patientId],
  );
  return rows.map((row) => row.status);
}

/** Waits until React has hydrated the element, so a click on it is the app's own navigation. */
async function hydrated(element: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        element.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the page' },
    )
    .toBe(true);
}

/** The app's own client navigation to an address, as a click on a link does it (no page load). */
async function goInApp(page: Page, href: string): Promise<void> {
  await page.evaluate((to) => {
    const next = (globalThis as unknown as { next?: { router?: { push(to: string): void } } }).next;
    if (!next?.router) throw new Error('The app has no router on the page.');
    next.router.push(to);
  }, href);
}

test('a patient in the chair reads so on the list and the profile, and as before once Done', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const own = OWN[testInfo.project.name];
  if (!own) throw new Error(`No day for the browser ${testInfo.project.name}.`);
  const name = `${FIRST} ${own.last}`;
  await remove(own.last);
  try {
    const id = await writePatientWithVisit(own.day, own.last);
    const profileUrl = `${APP}/patients/${id}`;

    const nextCell = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name, exact: true }) })
      .getByRole('cell')
      .nth(2);
    const card = page.locator('section[aria-labelledby="profile-next"]');

    // Booked, not yet in the chair: the list shows the date, the profile the visit.
    await page.goto(`${APP}/patients`);
    const link = page.getByRole('link', { name, exact: true });
    await expect(link).toBeVisible();
    await hydrated(link);
    await expect(nextCell).toContainText('10:00');
    await expect(nextCell).not.toContainText(list.inChairNow);
    await link.click();
    await expect(page).toHaveURL(profileUrl);
    await expect(card).toContainText('Checkup with Elena Planinska');
    await expect(card).not.toContainText(profile.inChairNow);

    // The calendar's day by the app's own navigation, so the list and the profile stay in the router.
    await goInApp(page, `/calendar?day=${own.day}`);
    await expect(page).toHaveURL(`${APP}/calendar?day=${own.day}`);
    const block = page.locator('button[data-appointment]').filter({ hasText: name });
    await expect(block).toBeVisible();
    await block.click();
    const open = page.getByRole('dialog', { name });
    await expect(open).toBeVisible();
    await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
    await open.getByRole('button', { name: 'In the chair', exact: true }).click();
    await expect(open.locator('[data-slot="badge"]')).toHaveText(status.arrived);
    expect(await statusOfVisit(id)).toEqual(['arrived']);

    // Back, through the router, to the profile and the list the browser had shown before.
    await page.goBack();
    await expect(page).toHaveURL(profileUrl);
    await expect(card).toContainText(profile.inChairNow);
    await expect(card).toContainText('Checkup with Elena Planinska');
    await expect(card).not.toContainText(profile.noNext);
    await page.goBack();
    await expect(page).toHaveURL(`${APP}/patients`);
    await expect(nextCell).toHaveText(list.inChairNow);

    // A fresh load of each reads the same.
    await page.goto(profileUrl);
    await expect(card).toContainText(profile.inChairNow);
    await page.goto(`${APP}/patients`);
    await expect(nextCell).toHaveText(list.inChairNow);

    // Done in the drawer: the visit is history, and both read as they did without it.
    await page.goto(`${APP}/calendar?day=${own.day}`);
    await expect(block).toBeVisible();
    await hydrated(block);
    await page.waitForLoadState('networkidle');
    await block.click();
    await expect(open).toBeVisible();
    await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
    await open.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(open.locator('[data-slot="badge"]')).toHaveText(status.completed);
    expect(await statusOfVisit(id)).toEqual(['completed']);

    await page.goto(profileUrl);
    await expect(card).toContainText(profile.noNext);
    await expect(card).not.toContainText(profile.inChairNow);
    await page.goto(`${APP}/patients`);
    await expect(nextCell).toHaveText(list.none);
    await expect(nextCell).not.toContainText(list.inChairNow);
  } finally {
    await remove(own.last);
  }
});
