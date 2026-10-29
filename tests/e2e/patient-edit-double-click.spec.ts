import { expect, test, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T03b, the tester's check: a double click on Save changes (pointer presses at the same spot, a
// moment apart) saves once: one `patient.updated` row, the stored value is the typed one, and the
// profile is where the person ends up. Each browser has a patient of its own, removed afterwards.

const t = messages.editPatient;
const profile = messages.patientProfile;
const LAST: Record<string, string> = {
  chromium: 'Dyfishim-Chromium',
  firefox: 'Dyfishim-Firefox',
  webkit: 'Dyfishim-Webkit',
};

let db: pg.Pool;
test.beforeAll(() => {
  db = new pg.Pool({ connectionString: e2eDatabase().migratorUrl, max: 1 });
});
test.afterAll(async () => {
  await db.end();
});

function lastOf(testInfo: TestInfo): string {
  const last = LAST[testInfo.project.name];
  if (!last) throw new Error(`No patient for the browser ${testInfo.project.name}.`);
  return last;
}

for (const gap of [80, 150, 250]) {
  test(`a double click on Save changes, ${gap} ms between the presses, saves once`, async ({
    page,
  }, testInfo) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into patients (id, clinic_id, first_name, last_name, language, phone_e164, notes)
       values (gen_random_uuid(), $1, 'Vjollca', $2, 'en', '+38970000911', 'Old note') returning id`,
      [SEEDED_CLINICS.harbourStreet, `${lastOf(testInfo)}-${gap}`],
    );
    const id = rows[0]!.id;
    try {
      await page.goto(`${APP}/patients/${id}`);
      await page.getByRole('link', { name: profile.edit, exact: true }).click();
      await expect(page).toHaveURL(`${APP}/patients/${id}/edit`);
      await page.getByLabel(messages.newPatient.notes).fill('Typed once');
      const box = await page.getByRole('button', { name: t.save, exact: true }).boundingBox();
      if (!box) throw new Error('no button');
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.click(x, y);
      await page.waitForTimeout(gap);
      await page.mouse.click(x, y);
      await expect(page).toHaveURL(`${APP}/patients/${id}`);
      await expect(page.getByText('Typed once', { exact: true })).toBeVisible();
      const updated = await db.query(
        `select 1 from audit_log where action = 'patient.updated' and entity_id = $1`,
        [id],
      );
      expect(updated.rows).toHaveLength(1);
      await expect(page.getByText(t.nothingChanged)).toHaveCount(0);
    } finally {
      await db.query('delete from patients where id = $1', [id]);
    }
  });
}
