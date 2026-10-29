import { expect, test, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { expectNoAxeViolations } from './axe.ts';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T03a in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): a click on a row of the patient list opens the profile, and that is
// one `patient.viewed` row; the list, a search and a hover write none; an address no patient of the
// clinic has answers 404 and writes none. The rows are counted in the database, by the patient's id.
// Each browser opens a patient of its own, so no other browser's click moves its counts. Names are
// the seed's invented ones; the assertions on the database name ids only.

const t = messages.patientProfile;

/** The patient each browser opens: a first and last name of the seed (src/db/seed/02-scheduling.ts). */
const PATIENTS: Record<string, { first: string; last: string }> = {
  chromium: { first: 'Ana', last: 'Brezovska' },
  firefox: { first: 'Bojan', last: 'Kamenov' },
  webkit: { first: 'Marko', last: 'Ezerovski' },
};

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

function patientOf(testInfo: TestInfo): { first: string; last: string } {
  const patient = PATIENTS[testInfo.project.name];
  if (!patient) throw new Error(`No patient for the browser ${testInfo.project.name}.`);
  return patient;
}

async function idOf(patient: { first: string; last: string }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from patients where clinic_id = $1 and first_name = $2 and last_name = $3`,
    [SEEDED_CLINICS.harbourStreet, patient.first, patient.last],
  );
  if (rows.length !== 1) throw new Error('The seed holds one such patient.');
  return rows[0]!.id;
}

/** The `patient.viewed` rows of one patient of the seeded clinic. */
async function views(patientId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log
     where clinic_id = $1 and action = 'patient.viewed' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, patientId],
  );
  return rows[0]!.n;
}

test('a click on a row of the list opens the profile, and that is one view', async ({
  page,
}, testInfo) => {
  const patient = patientOf(testInfo);
  const id = await idOf(patient);
  const before = await views(id);

  await page.goto(`${APP}/patients`);
  const name = `${patient.first} ${patient.last}`;
  const link = page.getByRole('link', { name, exact: true });
  await expect(link).toBeVisible();
  // The list, a search and a hover write nothing.
  await link.hover();
  await page.getByRole('searchbox').fill(patient.last);
  await expect(link).toBeVisible();
  await page.waitForTimeout(600); // the search's wait (250 ms) and its answer
  expect(await views(id)).toBe(before);

  await link.click();
  await expect(page).toHaveURL(`${APP}/patients/${id}`);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: t.history, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: t.back })).toBeVisible();
  // Not drawn until their epics: no Book button, no Messages, no Care plan.
  for (const words of ['Book appointment', 'Messages', 'Care plan', 'Treatment plan']) {
    await expect(page.getByText(words, { exact: true })).toHaveCount(0);
  }
  await expect.poll(() => views(id)).toBe(before + 1);
  await expectNoAxeViolations(page);

  // Back to the list is no view; the profile again is one more.
  await page.getByRole('link', { name: t.back }).click();
  await expect(page).toHaveURL(`${APP}/patients`);
  await page.waitForTimeout(300);
  expect(await views(id)).toBe(before + 1);
  await page.goto(`${APP}/patients/${id}`);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect.poll(() => views(id)).toBe(before + 2);
});

test('an address no patient of the clinic has answers 404 and writes no row', async ({ page }) => {
  for (const address of ['00000000-0000-7000-8000-000000000000', 'not-a-patient']) {
    const response = await page.goto(`${APP}/patients/${address}`);
    expect(response?.status()).toBe(404);
  }
  const { rows: none } = await db.query<{ n: number }>(
    `select count(*)::int as n from audit_log
     where action = 'patient.viewed' and entity_id = '00000000-0000-7000-8000-000000000000'`,
  );
  expect(none[0]!.n).toBe(0);
});
