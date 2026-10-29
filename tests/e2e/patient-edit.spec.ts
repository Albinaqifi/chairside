import { expect, test, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { expectNoAxeViolations } from './axe.ts';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T03b in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own). Acceptance 1, 2 and 8: an edit is saved and goes to the profile
// with a toast, the same form sent again is refused as changing nothing, and archiving a patient who
// has a visit ahead is refused with the visit listed, then saved once the visit is cancelled. Each
// browser works on a patient it adds itself (named for it, invented), far from the seeded ones that
// other journeys book and count, and removes what it wrote: the audit rows stay, ids alone. The rows
// are counted in the database, by the patient's id.

const t = messages.editPatient;
const profile = messages.patientProfile;

/** The patient and the day of the visit each browser uses (a Monday in 2031 the seed has no visit on). */
const BROWSERS: Record<string, { last: string; visit: string }> = {
  chromium: { last: 'Redaktim-Chromium', visit: '2031-12-01' },
  firefox: { last: 'Redaktim-Firefox', visit: '2031-12-02' },
  webkit: { last: 'Redaktim-Webkit', visit: '2031-12-03' },
};

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

function browserOf(testInfo: TestInfo): { last: string; visit: string } {
  const own = BROWSERS[testInfo.project.name];
  if (!own) throw new Error(`No patient for the browser ${testInfo.project.name}.`);
  return own;
}

/** Adds the browser's patient to the seeded clinic and returns their id. */
async function addPatient(last: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into patients (id, clinic_id, first_name, last_name, language, phone_e164, notes)
     values (gen_random_uuid(), $1, 'Vjollca', $2, 'en', '+38970000901', 'Old note')
     returning id`,
    [SEEDED_CLINICS.harbourStreet, last],
  );
  return rows[0]!.id;
}

/** Removes the patient and their visits; the audit rows stay. */
async function removePatient(id: string): Promise<void> {
  await db.query('delete from appointments where patient_id = $1', [id]);
  await db.query('delete from patients where id = $1', [id]);
}

async function updatedRows(id: string): Promise<unknown[]> {
  const { rows } = await db.query<{ metadata: unknown }>(
    `select metadata from audit_log where action = 'patient.updated' and entity_id = $1 order by at`,
    [id],
  );
  return rows.map((row) => row.metadata);
}

async function stored(id: string): Promise<{ status: string; notes: string; phone_e164: string }> {
  const { rows } = await db.query<{ status: string; notes: string; phone_e164: string }>(
    'select status, notes, phone_e164 from patients where id = $1',
    [id],
  );
  return rows[0]!;
}

/** Opens the patient's profile, and its edit page by the Edit link. */
async function openEdit(page: Page, id: string): Promise<void> {
  await page.goto(`${APP}/patients/${id}`);
  await page.getByRole('link', { name: profile.edit, exact: true }).click();
  await expect(page).toHaveURL(`${APP}/patients/${id}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
}

test('an edit is saved, goes to the profile with a toast, and the same form again changes nothing', async ({
  page,
}, testInfo) => {
  const { last } = browserOf(testInfo);
  const id = await addPatient(last);
  try {
    await openEdit(page, id);
    await expectNoAxeViolations(page);
    // The form holds what is stored, the phone as the clinic writes it.
    await expect(page.getByLabel(messages.newPatient.firstName)).toHaveValue('Vjollca');
    await expect(page.getByLabel(messages.newPatient.phone)).toHaveValue('070 000 901');
    await expect(page.getByLabel(t.status)).toHaveValue('active');

    // Saved untouched: refused, nothing written.
    await page.getByRole('button', { name: t.save, exact: true }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText(t.nothingChanged);
    expect(await updatedRows(id)).toEqual([]);

    await page.getByLabel(messages.newPatient.phone).fill('070 000 902');
    await page.getByLabel(messages.newPatient.notes).fill('A new note');
    await page.getByRole('button', { name: t.save, exact: true }).click();
    await expect(page.getByText(t.saved, { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${APP}/patients/${id}`);
    await expect(page.getByText('A new note', { exact: true })).toBeVisible();
    await expect(page.getByText('070 000 902', { exact: true })).toBeVisible();
    expect(await stored(id)).toMatchObject({ notes: 'A new note', phone_e164: '+38970000902' });
    expect(await updatedRows(id)).toEqual([{ fields: ['phone', 'notes'] }]);
  } finally {
    await removePatient(id);
  }
});

test('archiving a patient with a visit ahead is refused, and the visit listed; saved once it is cancelled', async ({
  page,
}, testInfo) => {
  const { last, visit } = browserOf(testInfo);
  const id = await addPatient(last);
  try {
    await db.query(
      `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                                 status, source, created_by)
       values (gen_random_uuid(), $1, $2, $3, 'Checkup',
               ($4::date + time '09:00') at time zone 'Europe/Skopje',
               ($4::date + time '09:30') at time zone 'Europe/Skopje', 'booked', 'staff', $5)`,
      [
        SEEDED_CLINICS.harbourStreet,
        id,
        SEEDED_PROVIDERS.harbourStreetDentist,
        visit,
        SEEDED_PEOPLE.owner.id,
      ],
    );
    await openEdit(page, id);
    await page.getByLabel(t.status).selectOption('archived');
    await page.getByRole('button', { name: t.save, exact: true }).click();
    await expect(page.locator('form').getByRole('alert')).toHaveText(t.visitsAhead);
    const list = page.getByRole('status').filter({ hasText: t.ahead.heading });
    await expect(list).toContainText('Checkup with Elena Planinska');
    await expect(list).toContainText('09:00');
    await expect(list).toContainText(t.ahead.cancelFirst);
    await expectNoAxeViolations(page);
    expect(await stored(id)).toMatchObject({ status: 'active' });
    expect(await updatedRows(id)).toEqual([]);

    // The desk cannot cancel from the app yet (E01-T06): the visit is cancelled in the database.
    await db.query(`update appointments set status = 'cancelled' where patient_id = $1`, [id]);
    await page.getByRole('button', { name: t.save, exact: true }).click();
    await expect(page).toHaveURL(`${APP}/patients/${id}`);
    await expect(page.getByText(messages.patients.archived, { exact: true })).toBeVisible();
    expect(await stored(id)).toMatchObject({ status: 'archived' });
    expect(await updatedRows(id)).toEqual([{ fields: ['status'] }]);
  } finally {
    await removePatient(id);
  }
});
