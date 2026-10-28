import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type TestInfo,
} from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { e2eDatabase } from './e2e-database.ts';
import { APP, OWNER_SESSION } from './servers.ts';

// E01-T09c in real browsers, on the production build, as the seeded owner (the global setup's
// session; no sign-in of its own), in the second seeded clinic. Acceptance 1: two providers added, one
// moved Up until it is above the other: the tab, the calendar's columns and the booking drawer's
// select follow, and the keyboard is at the heading. Acceptance 2 (the page's side): the first row has
// no Up and the last no Down. Acceptance 5: a double click on a row's Up, its two clicks 80, 150 and
// 250 ms apart, moves that provider one step, once.
//
// Never above the seeded dentist, which treatment-types.spec.ts needs as the drawer's first choice
// in this clinic, and never the first clinic's providers, which booking.spec.ts and calendar.spec.ts
// count: each check writes its own providers far down the order (sort_order 100 and on) and moves
// only those. A move renumbers the whole clinic 0 ... n-1 and keeps its relative order, so the other
// checks, in other browsers at the same moment, see no change. A neighbour in the order may be another
// browser's provider, so a check never assumes that one press passes its own sibling or that a place
// is absolute: it presses until the page shows its provider above the other, and asserts the order
// of its two providers alone. Each browser's rows carry its name, so the three browsers never meet on
// a row; each removes what it wrote. Names are invented.

const t = messages.settings.providers;
const booking = messages.calendar.booking;

const SONCOGLED_NAME = 'Забна клиника Сончоглед';
const SONCOGLED = SEEDED_CLINICS.soncogled;
/** The second clinic's seeded dentist, which no check here may move a provider above. */
const SEEDED_DENTIST = 'Љубица Ќошкова';

/** Each browser's day for the calendar: a weekday, far from every other check's days. */
const DAYS: Record<string, string> = {
  chromium: '2031-11-03',
  firefox: '2031-11-04',
  webkit: '2031-11-05',
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

/** Removes the second clinic's providers whose names start with `prefix`. The audit rows stay, ids alone. */
async function removeOwn(prefix: string): Promise<void> {
  await db.query(`delete from providers where clinic_id = $1 and starts_with(name, $2)`, [
    SONCOGLED,
    prefix,
  ]);
}

/**
 * Removes what a check wrote and, once no check of this file has providers left, gives the seeded
 * dentist her seeded place back. A move renumbers the clinic 0 ... n-1, so she ends at 0 where the seed
 * has her at 1, and providers.spec.ts expects a provider added after her to come at 2 or more: the
 * place is hers by the seed, a check that moves things puts it back. One statement, so another
 * browser's check that has just written its providers (all at 100 and on) is never met by a tie.
 */
async function leave(prefix: string): Promise<void> {
  await removeOwn(prefix);
  await db.query(
    `update providers set sort_order = 1
      where clinic_id = $1 and id = $2 and sort_order = 0
        and not exists (select 1 from providers other
                         where other.clinic_id = $1 and other.id <> $2
                           and (starts_with(other.name, 'Order ') or starts_with(other.name, 'Twice ')))`,
    [SONCOGLED, SEEDED_PROVIDERS.soncogledDentist],
  );
}

interface NewProvider {
  name: string;
  shortName: string;
}

/** Writes active dentists in the second clinic, after the seed's, as the migration role. */
async function addProviders(providers: readonly NewProvider[]): Promise<void> {
  await db.query(
    `insert into providers (id, clinic_id, name, short_name, kind, chair_label, color_hue, sort_order)
     select gen_random_uuid(), $1, each.name, each.short_name, 'dentist', 'Chair 8', 40, 100 + ord
       from unnest($2::text[], $3::text[]) with ordinality as each(name, short_name, ord)`,
    [SONCOGLED, providers.map((each) => each.name), providers.map((each) => each.shortName)],
  );
}

/**
 * These providers' names in the order the calendar reads (sort_order, name, id), as the database has
 * them now. The page is not asked: right after an answer it may still show the list as it was, and a
 * press decided from that would move the provider once too often, above a provider it must not pass.
 */
async function storedOrder(names: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select name from providers where clinic_id = $1 and name = any($2::text[])
      order by sort_order, name, id`,
    [SONCOGLED, names],
  );
  return rows.map((row) => row.name);
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

/** A provider's row: a group named by the provider. */
const providerRow = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

/** Every row of the tab, in the page's order. */
const allRows = (page: Page) => page.locator('li').filter({ has: page.getByRole('group') });

const upIn = (row: Locator) => row.getByRole('button', { name: t.moveUp, exact: true });
const downIn = (row: Locator) => row.getByRole('button', { name: t.moveDown, exact: true });

/** The names of the tab's rows, in the page's order. */
async function rowNames(page: Page): Promise<string[]> {
  return page
    .getByRole('group')
    .evaluateAll((groups) => groups.map((group) => group.getAttribute('aria-label') ?? ''));
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

/**
 * Presses the button until `done` says the order is as wanted. The browsers of the three projects
 * run at the same moment on one clinic, so a press may meet another browser's provider as its
 * neighbour, and two of their presses may cancel each other out on the list: a press is waited for by
 * its answer, never by a change of the list. Each shows the toast and leaves the keyboard at the
 * section's heading, the page rendered again.
 */
async function pressUntil(
  page: Page,
  button: () => Locator,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let press = 0; press < 12 && !(await done()); press += 1) {
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.request().headers()['next-action'] !== undefined,
    );
    await button().click();
    await answered;
    await expect(page.getByText(t.moved, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: t.heading, exact: true })).toBeFocused();
    await page.waitForLoadState('networkidle');
  }
  expect(await done()).toBe(true);
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

test.describe("the providers' order in Settings (E01-T09c)", () => {
  test.use({ storageState: OWNER_SESSION });

  test('Up moves a provider above the one before it, and the tab, the calendar and the booking drawer follow; the first row has no Up and the last no Down (acceptance 1, 2)', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo);
    const browser = testInfo.project.name;
    const prefix = `Order ${browser} `;
    const upper: NewProvider = {
      name: `${prefix}Mira Testova`,
      shortName: `O-${browser.slice(0, 3)}-M`,
    };
    const lower: NewProvider = {
      name: `${prefix}Ana Probna`,
      shortName: `O-${browser.slice(0, 3)}-A`,
    };
    await removeOwn(prefix);
    await addProviders([upper, lower]);
    try {
      await chooseClinic(page, SONCOGLED_NAME);
      await openTab(page);

      // The first row has no Up and the last no Down; each of the others has both.
      const rows = allRows(page);
      await expect(upIn(rows.first())).toHaveCount(0);
      await expect(downIn(rows.first())).toHaveCount(1);
      await expect(downIn(rows.last())).toHaveCount(0);
      await expect(upIn(rows.last())).toHaveCount(1);
      await expect(upIn(providerRow(page, lower.name))).toHaveCount(1);
      await expect(upIn(providerRow(page, upper.name))).toHaveCount(1);
      await expect(downIn(providerRow(page, upper.name))).toHaveCount(1);

      // Up on the lower one, until it is above the other. Each press shows the toast and leaves the
      // keyboard at the heading.
      const above = async () => {
        const names = await storedOrder([upper.name, lower.name]);
        return names.indexOf(lower.name) < names.indexOf(upper.name);
      };
      await pressUntil(page, () => upIn(providerRow(page, lower.name)), above);
      expect(await audited('provider.moved', lower.name)).toBeGreaterThanOrEqual(1);

      // A new load of the tab shows the order, and the seeded dentist is still above the two.
      await openTab(page);
      const reloaded = await rowNames(page);
      expect(reloaded.indexOf(lower.name)).toBeLessThan(reloaded.indexOf(upper.name));
      expect(reloaded.indexOf(SEEDED_DENTIST)).toBeLessThan(reloaded.indexOf(lower.name));

      // The calendar's columns: the lower one's column is left of the other's.
      await openCalendar(page, day);
      const boxOf = async (name: string) => {
        const box = await page.getByRole('list', { name, exact: true }).boundingBox();
        if (!box) throw new Error('A column has no box.');
        return box;
      };
      expect((await boxOf(lower.name)).x).toBeLessThan((await boxOf(upper.name)).x);

      // The drawer's select: in that order too.
      const choices = await drawerChoices(page);
      expect(choices.indexOf(lower.shortName)).toBeGreaterThanOrEqual(0);
      expect(choices.indexOf(lower.shortName)).toBeLessThan(choices.indexOf(upper.shortName));

      // Down on it, until it is below the other: the same way back.
      await openTab(page);
      const below = async () => {
        const names = await storedOrder([upper.name, lower.name]);
        return names.indexOf(lower.name) > names.indexOf(upper.name);
      };
      await pressUntil(page, () => downIn(providerRow(page, lower.name)), below);
    } finally {
      await leave(prefix);
    }
  });

  // Acceptance 5 (`message`): the row moves under the resting pointer once the first click's answer is
  // back, so a second press would move the provider again; the list takes no pointer click for a moment
  // after its rows change (SETTLE_MS).
  for (const gap of [80, 150, 250]) {
    test(`a double click on a row's Up, ${gap} ms between the clicks, moves that provider one step, once (acceptance 5)`, async ({
      page,
    }, testInfo) => {
      const browser = testInfo.project.name;
      const prefix = `Twice ${browser} ${gap} `;
      const tag = `T-${browser.slice(0, 3)}${gap}`;
      const providers: NewProvider[] = ['A', 'B', 'C'].map((letter) => ({
        name: `${prefix}${letter}`,
        shortName: `${tag}-${letter}`,
      }));
      const third = providers[2] as NewProvider;
      await removeOwn(prefix);
      await addProviders(providers);
      try {
        // Taller than the page: nothing scrolls.
        await page.setViewportSize({ width: 1280, height: 2400 });
        await chooseClinic(page, SONCOGLED_NAME);
        await openTab(page);
        const button = upIn(providerRow(page, third.name));
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
        // No place is asserted, as the other browsers' providers sit between and move meanwhile: the
        // action sent once, and one move of this provider in the audit log, say it moved one step.
        await page.waitForTimeout(1_200);
        await sent.answered();
        expect(sent.count(), 'actions sent for one double click').toBe(1);
        expect(await audited('provider.moved', third.name)).toBe(1);
      } finally {
        await leave(prefix);
      }
    });
  }
});
