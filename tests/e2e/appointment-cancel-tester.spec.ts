import { expect, test, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T06e, the tester's checks on the cancel dialog beyond the builder's: a visit changed behind the
// page (the stale dialog is refused, nothing written, the dialog stays and says so), the reason's
// extremes (exactly 200 characters, markup and quotes kept as text, only spaces kept as none),
// and a dialog opened again starting empty.
// As the seeded front desk, on the production build; each check works on a day of its browser's own and
// removes what it wrote. Names are the seed's invented ones.

const t = messages.calendar.appointment;
const dialogText = t.cancelDialog;

const DAYS: Record<string, Record<'stale' | 'reason' | 'reopen', string>> = {
  chromium: {
    stale: '2032-04-05',
    reason: '2032-04-06',
    reopen: '2032-04-07',
  },
  firefox: { stale: '2032-04-12', reason: '2032-04-13', reopen: '2032-04-14' },
  webkit: { stale: '2032-04-19', reason: '2032-04-20', reopen: '2032-04-21' },
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

async function visit(day: string, start: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + $3::time) at time zone 'Europe/Skopje',
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => 30),
            'booked', 'staff', $5
       from patients p
      where p.clinic_id = $1 and p.first_name = 'Mimoza' and p.last_name = 'Kodra'
     returning id`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      start,
      SEEDED_PROVIDERS.harbourStreetDentist,
      SEEDED_PEOPLE.frontDesk.id,
    ],
  );
  if (rows.length !== 1 || !rows[0]) throw new Error('The seed has no Mimoza Kodra.');
  return rows[0].id;
}

async function clear(day: string): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
}

async function rowOf(id: string) {
  const { rows } = await db.query<{
    status: string;
    cancelled_by: string | null;
    cancel_reason: string | null;
  }>(`select status, cancelled_by, cancel_reason from appointments where id = $1`, [id]);
  return rows[0];
}

async function auditCount(id: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'appointment.status_changed' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return Number(rows[0]?.n);
}

const block = (page: Page) =>
  page.locator('button[data-appointment]').filter({ hasText: 'Mimoza Kodra' });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Mimoza Kodra' });
const cancelDialog = (page: Page) => page.getByRole('dialog', { name: dialogText.title });

async function openCalendar(page: Page, day: string): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const first = block(page).first();
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

async function openCancelDialog(page: Page) {
  await block(page).click();
  const open = drawer(page);
  await expect(open).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  await open.getByRole('button', { name: t.actions.cancel.label, exact: true }).click();
  const dialog = cancelDialog(page);
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
  return { open, dialog };
}

test.describe('the cancel dialog, the tester', () => {
  test('a visit changed behind the page: Cancel visit is refused as changed meanwhile, the dialog stays open with the answer above its button, nothing is written', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'stale');
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      const { dialog } = await openCancelDialog(page);
      // Someone else completes the visit while the dialog is open.
      await db.query(`update appointments set status = 'completed' where id = $1`, [id]);

      await dialog
        .getByLabel(dialogText.who, { exact: true })
        .selectOption({ label: dialogText.patient });
      await dialog.getByRole('button', { name: dialogText.submit, exact: true }).click();
      await expect(
        dialog.getByText(t.refusals.notAllowed),
        'the refusal above the button',
      ).toBeVisible();
      await expect(dialog, 'the dialog stays open').toBeVisible();
      expect(await rowOf(id)).toMatchObject({ status: 'completed', cancelled_by: null });
      expect(await auditCount(id), 'no audit row for a refusal').toBe(0);
      // The dialog still closes by Escape once the answer is in.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    } finally {
      await clear(day);
    }
  });

  test('the reason: exactly 200 characters and markup with quotes are kept as typed text; only spaces is kept as none; spaces around are trimmed', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'reason');
    const cases: { reason: string; kept: string | null }[] = [
      { reason: 'x'.repeat(200), kept: 'x'.repeat(200) },
      { reason: `<b>"Late" & 'sorry'</b> ${'ž'.repeat(5)}`, kept: `<b>"Late" & 'sorry'</b> žžžžž` },
      { reason: '   ', kept: null },
      { reason: '  padded  ', kept: 'padded' },
    ];
    try {
      for (const { reason, kept } of cases) {
        await clear(day);
        const id = await visit(day, '09:00');
        await openCalendar(page, day);
        const { dialog } = await openCancelDialog(page);
        await dialog
          .getByLabel(dialogText.who, { exact: true })
          .selectOption({ label: dialogText.staff });
        await dialog.getByLabel(dialogText.reason, { exact: true }).fill(reason);
        await dialog.getByRole('button', { name: dialogText.submit, exact: true }).click();
        await expect(dialog).toBeHidden();
        expect(await rowOf(id), reason.slice(0, 12)).toMatchObject({
          status: 'cancelled',
          cancelled_by: 'staff',
          cancel_reason: kept,
        });
      }
    } finally {
      await clear(day);
    }
  });

  test('a dialog opened again starts empty: what was chosen and written before it was closed is gone', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'reopen');
    try {
      const id = await visit(day, '09:00');
      await openCalendar(page, day);
      const { open, dialog } = await openCancelDialog(page);
      await dialog
        .getByLabel(dialogText.who, { exact: true })
        .selectOption({ label: dialogText.patient });
      await dialog.getByLabel(dialogText.reason, { exact: true }).fill('half written');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
      await open.getByRole('button', { name: t.actions.cancel.label, exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(dialogText.who, { exact: true })).toHaveValue('');
      await expect(dialog.getByLabel(dialogText.reason, { exact: true })).toHaveValue('');
      expect(await rowOf(id)).toMatchObject({ status: 'booked' });
    } finally {
      await clear(day);
    }
  });
});
