import { expect, test, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T06b, the tester's checks (what the builder asked to be tried): a triple click on a block, and
// a double click on a status button itself, where the first press changes the status and the buttons
// are redrawn under the second. "In the chair" turns into the cell of another action; a second press
// that lands on it must change nothing more. One day a browser, each check its own visits, removed
// afterwards. The visits are written as the migration role, as appointment-drawer.spec.ts writes them.

const DAYS: Record<string, Record<'triple' | 'double' | 'done' | 'undo', string>> = {
  chromium: { triple: '2032-03-02', double: '2032-03-09', done: '2032-03-16', undo: '2032-03-23' },
  firefox: { triple: '2032-03-03', double: '2032-03-10', done: '2032-03-17', undo: '2032-03-24' },
  webkit: { triple: '2032-03-04', double: '2032-03-11', done: '2032-03-18', undo: '2032-03-25' },
};

function dayOf(testInfo: TestInfo, check: 'triple' | 'double' | 'done' | 'undo'): string {
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
  if (rows.length !== 1 || !rows[0]) throw new Error('The seed has no one Mimoza Kodra.');
  return rows[0].id;
}

async function clear(day: string): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await db.query<{ status: string }>(
    'select status from appointments where id = $1',
    [id],
  );
  return rows[0]?.status;
}

async function changeRows(id: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from audit_log
      where clinic_id = $1 and action = 'appointment.status_changed' and entity_id = $2`,
    [SEEDED_CLINICS.harbourStreet, id],
  );
  return Number(rows[0]?.n);
}

const block = (page: Page) =>
  page.locator('button[data-appointment]').filter({ hasText: 'Mimoza Kodra' });

async function openCalendar(page: Page, day: string): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const button = block(page).first();
  await expect(button).toBeVisible();
  await expect
    .poll(
      () =>
        button.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the calendar' },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

test.describe('E01-T06b, the tester: presses that must change nothing they were not meant to', () => {
  test('a triple click on a block opens the drawer and changes no status', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'triple');
    try {
      const ids: string[] = [];
      for (const start of ['08:00', '08:30', '09:00', '09:30']) ids.push(await visit(day, start));
      await openCalendar(page, day);
      const target = block(page).first();
      const box = await target.boundingBox();
      if (!box) throw new Error('No block to point at.');
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.click(at.x, at.y, { clickCount: 3, delay: 20 });
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(page.getByRole('dialog')).toBeVisible();
      for (const id of ids) {
        expect(await statusOf(id)).toBe('booked');
        expect(await changeRows(id)).toBe(0);
      }
    } finally {
      await clear(day);
    }
  });

  test('a double click on In the chair itself: one change, and the button redrawn under the second press changes nothing more', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const day = dayOf(testInfo, 'double');
    try {
      for (const gap of [40, 90, 150, 250]) {
        const id = await visit(day, '10:00');
        await openCalendar(page, day);
        await block(page).first().click();
        const open = page.getByRole('dialog');
        await expect(open).toBeVisible();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
        const button = open.getByRole('button', { name: 'In the chair', exact: true });
        const box = await button.boundingBox();
        if (!box) throw new Error('No In the chair button.');
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        await page.waitForTimeout(gap);
        await page.mouse.click(x, y);
        await page.waitForTimeout(1500);
        expect(
          await statusOf(id),
          `${gap} ms between the presses: the visit is in the chair, not past it`,
        ).toBe('arrived');
        expect(await changeRows(id), `${gap} ms: one change written`).toBe(1);
        await clear(day);
      }
    } finally {
      await clear(day);
    }
  });

  test('a double click on Done itself: one change, and Undo done redrawn under the second press changes nothing more', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const day = dayOf(testInfo, 'done');
    try {
      for (const gap of [40, 150, 250]) {
        const id = await visit(day, '10:00');
        await openCalendar(page, day);
        await block(page).first().click();
        const open = page.getByRole('dialog');
        await expect(open).toBeVisible();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
        await open.getByRole('button', { name: 'In the chair', exact: true }).click();
        await expect.poll(() => statusOf(id)).toBe('arrived');
        // The buttons change under the first press; wait out the moment they take no press.
        await page.waitForTimeout(1500);
        const button = open.getByRole('button', { name: 'Done', exact: true });
        const box = await button.boundingBox();
        if (!box) throw new Error('No Done button.');
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        await page.waitForTimeout(gap);
        await page.mouse.click(x, y);
        await page.waitForTimeout(1500);
        expect(await statusOf(id), `${gap} ms between the presses: done, not undone`).toBe(
          'completed',
        );
        expect(await changeRows(id), `${gap} ms: two changes written in all`).toBe(2);
        await clear(day);
      }
    } finally {
      await clear(day);
    }
  });

  test('a double click on Undo in the chair itself: back to booked once, and the button redrawn under the second press changes nothing more', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const day = dayOf(testInfo, 'undo');
    try {
      for (const gap of [40, 150, 250]) {
        const id = await visit(day, '10:00');
        await openCalendar(page, day);
        await block(page).first().click();
        const open = page.getByRole('dialog');
        await expect(open).toBeVisible();
        await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
        await open.getByRole('button', { name: 'In the chair', exact: true }).click();
        await expect.poll(() => statusOf(id)).toBe('arrived');
        await page.waitForTimeout(1500);
        const button = open.getByRole('button', { name: 'Undo in the chair', exact: true });
        const box = await button.boundingBox();
        if (!box) throw new Error('No Undo in the chair button.');
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        await page.waitForTimeout(gap);
        await page.mouse.click(x, y);
        await page.waitForTimeout(1500);
        expect(
          await statusOf(id),
          `${gap} ms between the presses: back to booked, no further`,
        ).toBe('booked');
        expect(await changeRows(id), `${gap} ms: two changes written in all`).toBe(2);
        await clear(day);
      }
    } finally {
      await clear(day);
    }
  });
});
