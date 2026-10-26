import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PEOPLE, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { DOUBLE_CLICK_MS } from '@/ui/double-click-guard';
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T05a in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): booking an existing patient from New appointment, with the mouse
// and with the keyboard alone; the block on the grid at once, in its provider's column also when the
// filter had it off; one booking for a double click on Book; a read on use while the drawer is open
// (the browser's clock moved); a double click on New appointment. Each check books on a day of its
// browser's own, in April 2031, far from the seed's week and from calendar.spec.ts's March days, so no
// other check's counts change; it removes what it booked. Names are the seed's invented ones.
//
// E01-T05b, on days of May 2031: the overlap warning and Book anyway, following start, length and
// provider, and its double click; a visit booked by someone else after the day was read, which the
// refused Book's answer brings; a read on use while the warning shows; the warning line for a break.
// The other visits are written as the migration role, as calendar.spec.ts writes its rows.
//
// E01-T05c, on days of June 2031: a click on an empty slot, a shaded one too, and on a block; a double
// click's second press in the drawer, from an empty slot and from New appointment; a double click on
// Book whose answer closes the drawer before its second click. The drawer drops a pointer's press for
// half a second after it opens (src/ui/double-click-guard.ts), so every check here lets that half
// second pass before its first press in the drawer (pressable()), as a person's first press comes.
//
// E01-T05d, on a day of July 2031: a new patient booked in one go, by pointer and by keyboard; the
// patient it adds is removed with the visit.

const t = messages.calendar.booking;

/** The days each browser books on, one a check: weekdays, open 08:00–18:00 like every weekday. */
const DAYS: Record<
  string,
  Record<
    | 'mouse'
    | 'keyboard'
    | 'filter'
    | 'twice'
    | 'read'
    | 'words'
    | 'anyway'
    | 'meanwhile'
    | 'readWarning'
    | 'breakLine'
    | 'slot'
    | 'saturday'
    | 'secondPress'
    | 'bookTwice'
    | 'closeTwice'
    | 'newPatient',
    string
  >
> = {
  chromium: {
    mouse: '2031-04-07',
    keyboard: '2031-04-08',
    filter: '2031-04-09',
    twice: '2031-04-10',
    read: '2031-04-11',
    words: '2031-04-28', // the tester's (acceptance 8)
    anyway: '2031-05-05', // E01-T05b's
    meanwhile: '2031-05-06',
    readWarning: '2031-05-07',
    breakLine: '2031-05-08',
    slot: '2031-06-02', // E01-T05c's
    saturday: '2031-06-07', // a Saturday: no opening hours
    secondPress: '2031-06-03',
    bookTwice: '2031-06-04',
    closeTwice: '2031-06-05', // E01-T05c's tester
    newPatient: '2031-07-07', // E01-T05d's
  },
  firefox: {
    mouse: '2031-04-14',
    keyboard: '2031-04-15',
    filter: '2031-04-16',
    twice: '2031-04-17',
    read: '2031-04-18',
    words: '2031-04-29',
    anyway: '2031-05-12',
    meanwhile: '2031-05-13',
    readWarning: '2031-05-14',
    breakLine: '2031-05-15',
    slot: '2031-06-09',
    saturday: '2031-06-14',
    secondPress: '2031-06-10',
    bookTwice: '2031-06-11',
    closeTwice: '2031-06-12',
    newPatient: '2031-07-14',
  },
  webkit: {
    mouse: '2031-04-21',
    keyboard: '2031-04-22',
    filter: '2031-04-23',
    twice: '2031-04-24',
    read: '2031-04-25',
    words: '2031-04-30',
    anyway: '2031-05-19',
    meanwhile: '2031-05-20',
    readWarning: '2031-05-21',
    breakLine: '2031-05-22',
    slot: '2031-06-16',
    saturday: '2031-06-21',
    secondPress: '2031-06-17',
    bookTwice: '2031-06-18',
    closeTwice: '2031-06-19',
    newPatient: '2031-07-21',
  },
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

interface Stored {
  patient: string;
  provider_id: string;
  title: string;
  starts: string;
  minutes: number;
  status: string;
}

/** The seeded clinic's appointments on the day, as booked: its local start in Skopje, its length. */
async function bookedOn(day: string): Promise<Stored[]> {
  const { rows } = await db.query<Stored>(
    `select p.first_name || ' ' || p.last_name as patient, a.provider_id, a.title, a.status,
            to_char(a.starts_at at time zone 'Europe/Skopje', 'HH24:MI') as starts,
            (extract(epoch from a.ends_at - a.starts_at) / 60)::int as minutes
       from appointments a join patients p on p.id = a.patient_id
      where a.clinic_id = $1 and (a.starts_at at time zone 'Europe/Skopje')::date = $2::date
      order by a.starts_at`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
  return rows;
}

/** The seeded clinic's appointments on the day: whose, the local start, whether booked anyway. */
async function overlapOkOn(day: string): Promise<[string, string, boolean][]> {
  const { rows } = await db.query<{ patient: string; starts: string; overlap_ok: boolean }>(
    `select p.first_name || ' ' || p.last_name as patient, a.overlap_ok,
            to_char(a.starts_at at time zone 'Europe/Skopje', 'HH24:MI') as starts
       from appointments a join patients p on p.id = a.patient_id
      where a.clinic_id = $1 and (a.starts_at at time zone 'Europe/Skopje')::date = $2::date
      order by a.starts_at, a.created_at`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
  return rows.map((row) => [row.patient, row.starts, row.overlap_ok]);
}

/**
 * A visit someone else booked: the seeded patient of that name with the dentist on the day, from the
 * local time for `minutes`, written as the migration role (E01-T05b).
 */
async function bookedElsewhere(
  day: string,
  start: string,
  minutes: number,
  [first, last]: [string, string],
): Promise<void> {
  const { rowCount } = await db.query(
    `insert into appointments (id, clinic_id, patient_id, provider_id, title, starts_at, ends_at,
                               status, source, created_by)
     select gen_random_uuid(), p.clinic_id, p.id, $4, 'Checkup',
            ($2::date + $3::time) at time zone 'Europe/Skopje',
            (($2::date + $3::time) at time zone 'Europe/Skopje') + make_interval(mins => $5),
            'booked', 'staff', $6
       from patients p
      where p.clinic_id = $1 and p.first_name = $7 and p.last_name = $8`,
    [
      SEEDED_CLINICS.harbourStreet,
      day,
      start,
      SEEDED_PROVIDERS.harbourStreetDentist,
      minutes,
      SEEDED_PEOPLE.frontDesk.id,
      first,
      last,
    ],
  );
  if (rowCount !== 1) throw new Error(`The seed has no one ${first} ${last}.`);
}

/** Removes what a check booked on its day. */
async function clear(day: string): Promise<void> {
  await db.query(
    `delete from appointments
      where clinic_id = $1 and (starts_at at time zone 'Europe/Skopje')::date = $2::date`,
    [SEEDED_CLINICS.harbourStreet, day],
  );
}

/** New appointment, in the calendar's header. */
const newAppointment = (page: Page) => page.getByRole('button', { name: t.open, exact: true });

/** The open drawer, named by its title. */
const drawer = (page: Page) => page.getByRole('dialog', { name: t.title });

/** A column of the grid, named by its provider. */
const column = (page: Page, provider: string) => page.getByRole('list', { name: provider });

/** The patient field's suggestions: the drawer's selects have options of their own. */
const suggestions = (open: Locator) =>
  open.getByRole('listbox', { name: t.suggestions }).getByRole('option');

/** The toasts showing, in their region: Radix's own copy for screen readers lasts a second only. */
const toasts = (page: Page) =>
  page.getByRole('region', { name: 'Notifications (F8)' }).getByRole('listitem');

/**
 * Closes the booking's toast with Escape and waits until no toast shows, before the drawer opens
 * again. The toast is one of Radix's layers, as the drawer is, and a drawer opened over it listens
 * for Escape only once React has rendered it as the top layer, work React schedules after the
 * opening: until then the toast's listener takes Escape and the drawer stays open
 * (@radix-ui/react-dismissable-layer 1.1.19; CI run 38643760726). Alone, the drawer listens from its
 * opening. A toast that does not take this Escape yet still goes after its 3.4 s, inside the wait.
 */
async function closeToast(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(toasts(page), 'no toast up when the drawer opens').toHaveCount(0);
}

/**
 * Opens the calendar on `day` and waits until React has hydrated New appointment (it holds React's
 * props) and the page has settled: a click before would open nothing.
 */
async function openCalendar(page: Page, day: string): Promise<void> {
  await page.goto(`${APP}/calendar?day=${day}`);
  const button = newAppointment(page);
  await expect
    .poll(
      () =>
        button.evaluate((node) => Object.keys(node).some((key) => key.startsWith('__reactProps'))),
      { message: 'React has hydrated the calendar' },
    )
    .toBe(true);
  await page.waitForLoadState('networkidle');
}

/**
 * Lets the drawer's half second pass after it opened, before the first press of a pointer in it: a
 * press sooner is a double click's second, which it drops (E01-T05c, src/ui/double-click-guard.ts). A
 * person's first press comes later; Playwright's comes at once. With the page's clock installed and
 * paused, the half second is the page's fake clock's: Playwright stamps each event with its time.
 */
async function pressable(page: Page, clock: 'real' | 'paused' = 'real'): Promise<void> {
  if (clock === 'paused') await page.clock.runFor(DOUBLE_CLICK_MS);
  else await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
}

/** A JavaScript value the page keeps until it is loaded again: there after a booking, no reload. */
async function markPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { notReloaded: boolean }).notReloaded = true;
  });
}
async function notReloaded(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded === true);
}

test.describe('booking an existing patient from New appointment (acceptance 1 and 3)', () => {
  test('type part of the name, pick them, pick a treatment, Book: start, length and provider come filled in', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'mouse');
    try {
      await openCalendar(page, day);
      await markPage(page);
      await newAppointment(page).click();
      const open = drawer(page);
      await expect(open).toBeVisible();
      const patient = open.getByRole('combobox', { name: t.patient });
      await expect(patient, 'the patient field has the focus first').toBeFocused();
      await pressable(page);
      // Filled in: the day's opening (not the clinic's today), 30 minutes, the first column shown.
      await expect(open.getByLabel(t.start, { exact: true })).toHaveValue('08:00');
      await expect(open.getByLabel(t.length, { exact: true })).toHaveValue('30');
      await expect(open.getByLabel(t.provider, { exact: true })).toHaveValue(
        SEEDED_PROVIDERS.harbourStreetDentist,
      );

      // 1. Type part of the name. 2. Pick them.
      await patient.fill('Mimoza K');
      const suggestion = suggestions(open).filter({ hasText: 'Mimoza Kodra' });
      // The one patient found, then "Add … as new patient", the list's last option from the third
      // character (E01-T05d): two options once the search has answered.
      await expect(suggestions(open)).toHaveCount(2);
      await expect(suggestions(open).first()).toContainText('Mimoza Kodra');
      await suggestion.click();
      await expect(patient).toHaveValue('Mimoza Kodra');
      // 3. Pick a treatment: its length.
      await open.getByRole('button', { name: 'Filling', exact: true }).click();
      await expect(open.getByLabel(t.length, { exact: true })).toHaveValue('45');
      await expect(open).toContainText('08:00–08:45');
      // 4. Book.
      await open.getByRole('button', { name: 'Book 08:00 with Dr. Planinska' }).click();

      await expect(open).toBeHidden();
      // The toast, in its region: Radix's own copy for screen readers lasts a second only.
      await expect(
        page
          .getByRole('region', { name: 'Notifications (F8)' })
          .getByText('Booked Mimoza Kodra, 08:00.', { exact: true }),
      ).toBeVisible();
      // The block on the grid without a reload, in its provider's column.
      const block = column(page, 'Elena Planinska').locator('li[data-status]');
      await expect(block).toContainText('Mimoza Kodra');
      await expect(block).toContainText('08:00');
      await expect(block).toContainText('Filling');
      expect(await notReloaded(page), 'the page was not loaded again').toBe(true);
      expect(await bookedOn(day)).toEqual([
        {
          patient: 'Mimoza Kodra',
          provider_id: SEEDED_PROVIDERS.harbourStreetDentist,
          title: 'Filling',
          starts: '08:00',
          minutes: 45,
          status: 'booked',
        },
      ]);
      // A new opening starts a new booking; the booking's toast is closed first (closeToast).
      await closeToast(page);
      await newAppointment(page).click();
      await expect(drawer(page).getByRole('combobox', { name: t.patient })).toHaveValue('');
      await page.keyboard.press('Escape');
      await expect(drawer(page)).toBeHidden();
    } finally {
      await clear(day);
    }
  });

  test('an archived patient shows with their label and cannot be picked', async ({ page }) => {
    await openCalendar(page, '2031-04-07');
    await newAppointment(page).click();
    await pressable(page);
    const open = drawer(page);
    const patient = open.getByRole('combobox', { name: t.patient });
    await patient.fill('Planinska');
    const archived = suggestions(open).filter({ hasText: 'Ana Planinska' });
    await expect(archived).toContainText(messages.patients.archived);
    await expect(archived).toHaveAttribute('aria-disabled', 'true');
    // Playwright waits for a disabled option to be enabled: the press is made anyway.
    await archived.click({ force: true });
    await expect(patient, 'nothing picked').toHaveValue('Planinska');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(patient, 'nor by Enter').toHaveValue('Planinska');
    await expect(open, 'Enter sent nothing').toBeVisible();
  });
});

test.describe('by keyboard alone (acceptance 2)', () => {
  test('the arrow keys and Enter pick a suggestion, Enter never sends the form, Escape closes the list then the drawer, Tab reaches every field and Book', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'keyboard');
    try {
      await openCalendar(page, day);
      await newAppointment(page).focus();
      await page.keyboard.press('Enter');
      const open = drawer(page);
      const patient = open.getByRole('combobox', { name: t.patient });
      await expect(patient).toBeFocused();

      await page.keyboard.type('Mimoza K');
      const list = open.getByRole('listbox');
      // The one patient found, then "Add … as new patient", the list's last option from the third
      // character (E01-T05d): two options once the search has answered.
      await expect(suggestions(open)).toHaveCount(2);
      await expect(suggestions(open).first()).toContainText('Mimoza Kodra');
      await expect(patient).toHaveAttribute('aria-expanded', 'true');
      // Escape closes the list; the drawer stays.
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(open).toBeVisible();
      // The arrow key opens it again and moves to the suggestion; Enter picks it.
      await page.keyboard.press('ArrowDown');
      await expect(list).toBeVisible();
      await expect(patient).toHaveAttribute('aria-activedescendant', /.+/);
      await page.keyboard.press('Enter');
      await expect(patient).toHaveValue('Mimoza Kodra');
      // Enter in the field again sends nothing.
      await page.keyboard.press('Enter');
      await expect(open).toBeVisible();
      expect(await bookedOn(day)).toEqual([]);

      // Tab from the field: each treatment's chip, then start, length and provider, then Book.
      const chips = await open
        .getByRole('group', { name: t.treatment })
        .getByRole('button')
        .allTextContents();
      expect(chips).toHaveLength(10);
      const reached: string[] = [];
      for (let presses = 0; presses < 20; presses++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element) return '';
          return element.tagName === 'SELECT'
            ? `select ${element.getAttribute('name') ?? ''}`
            : (element.textContent ?? '').trim();
        });
        reached.push(focused);
        if (focused.startsWith('Book ')) break;
        // The first chip: Space presses it.
        if (reached.length === 1) await page.keyboard.press('Space');
      }
      expect(reached).toEqual([
        ...chips,
        'select start',
        'select length',
        'select providerId',
        `Book 08:00 with Dr. Planinska`,
      ]);
      await expect(open.getByRole('button', { name: chips[0], exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // Enter on Book books.
      await page.keyboard.press('Enter');
      await expect(open).toBeHidden();
      await expect(newAppointment(page), 'the focus back on New appointment').toBeFocused();
      await expect(column(page, 'Elena Planinska').locator('li[data-status]')).toContainText(
        'Mimoza Kodra',
      );
      expect((await bookedOn(day)).map(({ patient: name, title }) => [name, title])).toEqual([
        ['Mimoza Kodra', chips[0]],
      ]);

      // Escape with the list closed closes the drawer, opened with the booking's toast closed first
      // (closeToast).
      await closeToast(page);
      await page.keyboard.press('Enter');
      await expect(drawer(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer(page)).toBeHidden();
    } finally {
      await clear(day);
    }
  });
});

test.describe('after Book (acceptance 3)', () => {
  test("the provider's column is turned on when the filter had it off", async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'filter');
    try {
      await openCalendar(page, day);
      const chip = page
        .getByRole('group', { name: messages.calendar.providerFilter })
        .getByRole('button', { name: 'M. Lumi', exact: true });
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(column(page, 'Mimoza Lumi')).toHaveCount(0);

      await newAppointment(page).click();
      await pressable(page);
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill('Mimoza K');
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Cleaning', exact: true }).click();
      await open.getByLabel(t.provider, { exact: true }).selectOption({ label: 'M. Lumi' });
      await open.getByLabel(t.start, { exact: true }).selectOption('14:30');
      await open.getByRole('button', { name: 'Book 14:30 with M. Lumi' }).click();

      await expect(open).toBeHidden();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expect(column(page, 'Mimoza Lumi').locator('li[data-status]')).toContainText(
        'Mimoza Kodra',
      );
      expect(await bookedOn(day)).toMatchObject([
        { provider_id: SEEDED_PROVIDERS.harbourStreetHygienist, starts: '14:30', minutes: 45 },
      ]);
    } finally {
      await clear(day);
    }
  });

  test('a double click on Book books one', async ({ page }, testInfo) => {
    const day = dayOf(testInfo, 'twice');
    try {
      await openCalendar(page, day);
      await newAppointment(page).click();
      await pressable(page);
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill('Mimoza K');
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      await open.getByRole('button', { name: /^Book / }).dblclick();
      await expect(open).toBeHidden();
      await expect(column(page, 'Elena Planinska').locator('li[data-status]')).toHaveCount(1);
      await page.waitForLoadState('networkidle');
      expect(await bookedOn(day)).toHaveLength(1);
    } finally {
      await clear(day);
    }
  });
});

test.describe('a read on use while the drawer is open (acceptance 9)', () => {
  test('keeps everything typed and chosen in it, and books what it shows', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'read');
    // A POST with Next.js's action header to the calendar's address: the read, or the booking.
    const actions: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) {
        actions.push(new URL(request.url()).pathname);
      }
    });
    try {
      await page.clock.install();
      await openCalendar(page, day);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

      await newAppointment(page).click();
      await pressable(page, 'paused');
      const open = drawer(page);
      const patient = open.getByRole('combobox', { name: t.patient });
      await patient.fill('Mimoza K');
      // The search waits a moment after the last key, on the page's clock.
      await page.clock.runFor(300);
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Crown fit', exact: true }).click();
      await open.getByLabel(t.start, { exact: true }).selectOption('10:30');
      await open.getByLabel(t.length, { exact: true }).selectOption('90');
      await open.getByLabel(t.provider, { exact: true }).selectOption({ label: 'M. Lumi' });
      const before = actions.filter((path) => path === '/calendar').length;

      // 31 seconds on, the page is used inside the drawer: the day is read again under it.
      await page.clock.fastForward(31_000);
      const read = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.request().headers()['next-action'] !== undefined,
      );
      const title = open.getByRole('heading', { name: t.title });
      const box = await title.boundingBox();
      if (!box) throw new Error('The drawer has no title to move the pointer over.');
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.move(box.x + 15, box.y + 5);
      await page.keyboard.press('Shift');
      await read;
      expect(actions.filter((path) => path === '/calendar').length, 'one read').toBe(before + 1);

      await expect(open).toBeVisible();
      await expect(patient).toHaveValue('Mimoza Kodra');
      await expect(open.getByRole('button', { name: 'Crown fit', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(open.getByLabel(t.start, { exact: true })).toHaveValue('10:30');
      await expect(open.getByLabel(t.length, { exact: true })).toHaveValue('90');
      await expect(open.getByLabel(t.provider, { exact: true })).toHaveValue(
        SEEDED_PROVIDERS.harbourStreetHygienist,
      );
      await expect(open).toContainText('10:30–12:00');

      await open.getByRole('button', { name: 'Book 10:30 with M. Lumi' }).click();
      await expect(open).toBeHidden();
      expect(await bookedOn(day)).toEqual([
        {
          patient: 'Mimoza Kodra',
          provider_id: SEEDED_PROVIDERS.harbourStreetHygienist,
          title: 'Crown fit',
          starts: '10:30',
          minutes: 90,
          status: 'booked',
        },
      ]);
      await page.waitForLoadState('networkidle');
    } finally {
      await clear(day);
    }
  });
});

/** A request's body without its multipart boundaries: random letters, which could spell a word. */
function withoutBoundaries(body: string): string {
  const first = body.split(/\r?\n/, 1)[0] ?? '';
  return first.startsWith('--') && first.length > 2 ? body.split(first).join('') : body;
}

test.describe("the patient search's words in no address and no booking (acceptance 8, tester)", () => {
  test("after a search the address holds none of its words, and the booking's request none either", async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'words');
    // What is typed: the start of a seeded patient's first and last names. Each word is looked for in
    // lower case, as written and URL-decoded; neither is a hexadecimal word, so no id holds one.
    const typed = 'Mimoza Kod';
    const words = ['mimoza', 'kod'];
    const holdsWord = (text: string) => {
      const lower = text.toLowerCase();
      let decoded = lower;
      try {
        decoded = decodeURIComponent(lower);
      } catch {
        // Not URL-encoded: as written.
      }
      return words.some((word) => lower.includes(word) || decoded.includes(word));
    };
    const { rows } = await db.query<{ id: string }>(
      `select id from patients where clinic_id = $1 and first_name = 'Mimoza' and last_name = 'Kodra'`,
      [SEEDED_CLINICS.harbourStreet],
    );
    const picked = rows[0]?.id;
    if (rows.length !== 1 || !picked) throw new Error('The seed has no one Mimoza Kodra.');

    const requests: {
      url: string;
      method: string;
      action: boolean;
      body: string;
      headers: string;
    }[] = [];
    page.on('request', (request) => {
      const headers = request.headers();
      requests.push({
        url: request.url(),
        method: request.method(),
        action: headers['next-action'] !== undefined,
        body: withoutBoundaries(request.postData() ?? ''),
        // Every header but the cookie, whose random letters could spell a word.
        headers: JSON.stringify(Object.entries(headers).filter(([name]) => name !== 'cookie')),
      });
    });
    try {
      await openCalendar(page, day);
      await newAppointment(page).click();
      await pressable(page);
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill(typed);
      // The one patient found, then "Add … as new patient", the list's last option from the third
      // character (E01-T05d): two options once the search has answered.
      await expect(suggestions(open)).toHaveCount(2);
      await expect(suggestions(open).first()).toContainText('Mimoza Kodra');
      // The search sent its words in a request's body, a POST to the calendar's own address.
      const searches = requests.filter((request) => request.action && holdsWord(request.body));
      expect(searches.length, 'the search sent its words').toBeGreaterThan(0);
      for (const search of searches) {
        expect(search.method).toBe('POST');
        expect(holdsWord(search.url), 'the search request’s address').toBe(false);
      }
      expect(holdsWord(page.url()), 'the address after the search').toBe(false);

      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      await open.getByRole('button', { name: /^Book / }).click();
      await expect(open).toBeHidden();
      await page.waitForLoadState('networkidle');
      expect(await bookedOn(day)).toMatchObject([{ patient: 'Mimoza Kodra', title: 'Checkup' }]);

      // The booking's request: the patient picked by id, none of the words searched for.
      const bookings = requests.filter(
        (request) => request.action && request.body.includes('patientId'),
      );
      expect(bookings, 'one booking request').toHaveLength(1);
      expect(bookings[0]?.body).toContain(picked);
      expect(holdsWord(bookings[0]?.body ?? ''), 'the booking request’s body').toBe(false);
      expect(holdsWord(bookings[0]?.headers ?? ''), 'the booking request’s headers').toBe(false);
      // No address the page asked for holds a word, nor a header naming the page's (its referer);
      // nor the page's own.
      for (const request of requests) {
        expect(holdsWord(request.url), request.url).toBe(false);
        expect(holdsWord(request.headers), `the headers of ${request.url}`).toBe(false);
      }
      expect(holdsWord(page.url()), 'the address after the booking').toBe(false);
    } finally {
      await clear(day);
    }
  });
});

test.describe('a double click on New appointment (acceptance 10, E00-T04e tester)', () => {
  // The content is at most 1,240 px wide, at the left: on a 1920 px screen New appointment is left
  // of where the drawer opens, so the second click of a double click lands on the overlay. On a
  // narrower one it lands in the drawer itself: on its header, or on its Close button (the next
  // check, at 1280 px).
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('leaves the drawer open; a click on the overlay a second later closes it', async ({
    page,
  }) => {
    await openCalendar(page, '2031-04-07');
    const button = newAppointment(page);
    const box = await button.boundingBox();
    if (!box) throw new Error('New appointment has no box.');
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Playwright's own double click: its two clicks a few milliseconds apart.
    await button.dblclick();
    await page.waitForTimeout(700);
    await expect(drawer(page)).toBeVisible();
    const opened = await drawer(page).boundingBox();
    expect(opened && at.x < opened.x, "the button's place is on the overlay").toBe(true);

    // A second later, a click on the overlay closes it.
    await page.waitForTimeout(1_000);
    await page.mouse.click(at.x, at.y);
    await expect(drawer(page)).toBeHidden();

    // Two clicks 150 ms apart at the button's place: the second lands on the overlay. How far apart
    // they reached the page is the page's to say: on a machine busy with three browsers the wait and
    // the clicks take longer than asked, and two presses half a second apart are no double click.
    await page.evaluate(() => {
      const presses: number[] = [];
      (window as unknown as { presses: number[] }).presses = presses;
      document.addEventListener('pointerdown', (event) => presses.push(event.timeStamp), true);
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(150);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(700);
    const [first = 0, second = Infinity] = await page.evaluate(
      () => (window as unknown as { presses: number[] }).presses,
    );
    if (second - first < 400) {
      await expect(drawer(page)).toBeVisible();
    } else {
      test.info().annotations.push({
        type: 'not checked',
        description: `the two presses reached the page ${Math.round(second - first)} ms apart`,
      });
    }
  });
});

test.describe("a double click on New appointment's right part at 1280 px (acceptance 10, E01-T05a tester, finding 1)", () => {
  // From 1280 to 1536 px wide the drawer's Close button opens under New appointment's right part, so
  // the second click of a double click there lands on Close. Close ignores a pointer's press for as
  // long as a double click lasts after the drawer opened, as the overlay does
  // (src/ui/double-click-guard.ts); pressed on its own it closes the drawer, and so do Escape and a
  // key on Close.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('leaves the drawer open, 80, 150 and 250 ms between the clicks; Close pressed a second later, Escape and a key on Close close it', async ({
    page,
  }) => {
    await openCalendar(page, '2031-04-07');
    const button = newAppointment(page);
    const close = drawer(page).getByRole('button', { name: messages.drawer.close, exact: true });

    // Where Close opens: the drawer opened once, then closed by Escape.
    await button.click();
    await expect(drawer(page)).toBeVisible();
    const closeBox = await close.boundingBox();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeHidden();
    const box = await button.boundingBox();
    if (!box || !closeBox) throw new Error('New appointment or Close has no box.');
    // A point on both: on New appointment while the drawer is closed, on Close once it is open.
    const left = Math.max(box.x, closeBox.x);
    const right = Math.min(box.x + box.width, closeBox.x + closeBox.width);
    const top = Math.max(box.y, closeBox.y);
    const bottom = Math.min(box.y + box.height, closeBox.y + closeBox.height);
    expect(left < right && top < bottom, "Close opens under New appointment's right part").toBe(
      true,
    );
    const at = { x: (left + right) / 2, y: (top + bottom) / 2 };

    // Each press the page gets: its time stamp, and whether it landed on Close.
    type Press = { at: number; onClose: boolean };
    await page.evaluate(() => {
      const presses: Press[] = [];
      (window as unknown as { presses: Press[] }).presses = presses;
      document.addEventListener(
        'pointerdown',
        (event) => {
          const target = event.target instanceof Element ? event.target : null;
          presses.push({
            at: event.timeStamp,
            onClose: Boolean(target?.closest('[data-slot="sheet-close"]')),
          });
        },
        true,
      );
    });

    // A click at that point, in one call to Playwright: a press and a release sent as two calls reach
    // the page later, further apart than the gap asked for.
    const click = () => page.mouse.click(at.x, at.y);

    // Not Playwright's own double click: its second press, a few milliseconds after the first, lands
    // on the overlay in Chromium (now and then in Firefox too), not on Close.
    for (const gap of [80, 150, 250]) {
      await page.evaluate(() => {
        (window as unknown as { presses: Press[] }).presses.length = 0;
      });
      await click();
      await page.waitForTimeout(gap);
      await click();
      await page.waitForTimeout(700);
      const [first, second] = await page.evaluate(
        () => (window as unknown as { presses: Press[] }).presses,
      );
      if (!first || !second) throw new Error(`${gap} ms: the page got fewer than two presses.`);
      // The drawer opens between the two presses, so two presses less than half a second apart are a
      // double click by the guard's rule. How far apart they reached the page is the page's to say,
      // as in the check above; 450 ms leaves a margin.
      if (second.at - first.at < 450) {
        expect(second.onClose, `${gap} ms: the second press on Close`).toBe(true);
        await expect(drawer(page), `${gap} ms: the drawer still open`).toBeVisible();
        // Close pressed on its own, a second after the drawer opened, closes it.
        await page.waitForTimeout(300);
        await click();
      } else {
        test.info().annotations.push({
          type: 'not checked',
          description: `${gap} ms: the two presses reached the page ${Math.round(second.at - first.at)} ms apart`,
        });
        await page.keyboard.press('Escape');
      }
      await expect(drawer(page), `${gap} ms: closed again`).toBeHidden();
    }

    // Escape closes it at once after a double click (here Playwright's: where its second press lands
    // does not matter).
    await page.mouse.dblclick(at.x, at.y);
    await page.keyboard.press('Escape');
    await expect(drawer(page), 'closed by Escape').toBeHidden();

    // A key on Close closes it at once after it opened: Shift+Tab from the first field reaches it.
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(drawer(page).getByRole('combobox', { name: t.patient })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close, 'Shift+Tab from the patient field reaches Close').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(drawer(page), 'closed by Enter on Close').toBeHidden();
  });
});

/** The drawer's text for a visit the time overlaps (E01-T05b): "Overlaps Ana Brezovska's visit, …". */
const overlapsVisit = (name: string, from: string, to: string) =>
  t.warning.overlap.replace('{name}', name).replace('{from}', from).replace('{to}', to);

/**
 * Every action the page sends from now on (a POST with Next.js's action header): its address, and
 * whether it is a booking (the only one that sends a patient's id) rather than a read or a search.
 */
function countActions(page: Page): { path: string; booking: boolean }[] {
  const actions: { path: string; booking: boolean }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.headers()['next-action'] !== undefined) {
      actions.push({
        path: new URL(request.url()).pathname,
        booking: (request.postData() ?? '').includes('patientId'),
      });
    }
  });
  return actions;
}

test.describe('an overlap and Book anyway (E01-T05b, acceptance 1, 3 and 5)', () => {
  test('the warning names the other visit and follows start, length and provider; a double click on Book anyway books one, with overlap_ok', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'anyway');
    try {
      await bookedElsewhere(day, '10:00', 30, ['Bojan', 'Kamenov']);
      await openCalendar(page, day);
      await newAppointment(page).click();
      await pressable(page);
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill('Mimoza K');
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      const start = open.getByLabel(t.start, { exact: true });
      const length = open.getByLabel(t.length, { exact: true });
      const provider = open.getByLabel(t.provider, { exact: true });
      const warning = open.getByText(overlapsVisit('Bojan Kamenov', '10:00', '10:30'), {
        exact: true,
      });
      const book = open.getByRole('button', { name: /^Book / });

      // Over the other visit: the warning, and Book anyway.
      await start.selectOption('10:15');
      await expect(warning).toBeVisible();
      await expect(open.getByText(t.warning.anyway, { exact: true })).toBeVisible();
      await expect(book).toHaveText('Book anyway, 10:15 with Dr. Planinska');
      // The start after it: gone.
      await start.selectOption('10:30');
      await expect(warning).toBeHidden();
      await expect(book).toHaveText('Book 10:30 with Dr. Planinska');
      // 09:45 for 30 minutes runs into it; for 15 it ends as the other visit starts.
      await start.selectOption('09:45');
      await expect(warning).toBeVisible();
      await length.selectOption('15');
      await expect(warning).toBeHidden();
      await length.selectOption('30');
      await expect(warning).toBeVisible();
      // Another provider is free then.
      await provider.selectOption({ label: 'Dr. Kodra' });
      await expect(warning).toBeHidden();
      await expect(book).toHaveText('Book 09:45 with Dr. Kodra');
      await provider.selectOption({ label: 'Dr. Planinska' });
      await start.selectOption('10:15');
      await expect(book).toHaveText('Book anyway, 10:15 with Dr. Planinska');

      // A double click on Book anyway books one.
      const actions = countActions(page);
      await book.dblclick();
      await expect(open).toBeHidden();
      await expect(column(page, 'Elena Planinska').locator('li[data-status]')).toHaveCount(2);
      await page.waitForLoadState('networkidle');
      expect(
        actions.filter((action) => action.booking),
        'one booking request',
      ).toHaveLength(1);
      expect(await overlapOkOn(day)).toEqual([
        ['Bojan Kamenov', '10:00', false],
        ['Mimoza Kodra', '10:15', true],
      ]);
    } finally {
      await clear(day);
    }
  });
});

test.describe('a visit booked by someone else after the day was read (E01-T05b, acceptance 2)', () => {
  test('Book is refused, its answer brings the day: the warning names that visit without a reload, and Book anyway books it', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'meanwhile');
    try {
      // The page's clock stands still, so no read on use comes: only the booking's answer can bring
      // the day.
      await page.clock.install();
      await openCalendar(page, day);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
      await markPage(page);
      await newAppointment(page).click();
      await pressable(page, 'paused');
      const open = drawer(page);
      const patient = open.getByRole('combobox', { name: t.patient });
      await patient.fill('Mimoza K');
      // The search waits a moment after the last key, on the page's clock.
      await page.clock.runFor(300);
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      await open.getByLabel(t.start, { exact: true }).selectOption('09:00');
      const book = open.getByRole('button', { name: /^Book / });
      await expect(book).toHaveText('Book 09:00 with Dr. Planinska');

      // Someone else books Bojan Kamenov with the same provider at 09:00 meanwhile.
      await bookedElsewhere(day, '09:00', 30, ['Bojan', 'Kamenov']);
      const actions = countActions(page);
      await book.click();
      // Refused, its text above Book.
      await expect(open.getByRole('alert')).toHaveText(t.overlap);
      // The answer brought the day: the warning names that visit, and Book is Book anyway.
      await expect(
        open.getByText(overlapsVisit('Bojan Kamenov', '09:00', '09:30'), { exact: true }),
      ).toBeVisible();
      await expect(book).toHaveText('Book anyway, 09:00 with Dr. Planinska');
      expect(actions, 'one request: the booking, whose answer brought the day').toEqual([
        { path: '/calendar', booking: true },
      ]);
      expect(await notReloaded(page), 'the page was not loaded again').toBe(true);
      // Nothing typed or chosen changed with it.
      await expect(patient).toHaveValue('Mimoza Kodra');
      await expect(open.getByRole('button', { name: 'Checkup', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(await bookedOn(day)).toHaveLength(1);

      // Book anyway, one press away.
      await book.click();
      await expect(open).toBeHidden();
      expect(await overlapOkOn(day)).toEqual([
        ['Bojan Kamenov', '09:00', false],
        ['Mimoza Kodra', '09:00', true],
      ]);
      await page.waitForLoadState('networkidle');
    } finally {
      await clear(day);
    }
  });
});

test.describe('a read on use while the warning shows (E01-T05b, acceptance 5)', () => {
  test('keeps everything typed and chosen; the warning follows the day the read brings', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'readWarning');
    const actions = countActions(page);
    try {
      await bookedElsewhere(day, '09:00', 30, ['Bojan', 'Kamenov']);
      await page.clock.install();
      await openCalendar(page, day);
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

      await newAppointment(page).click();
      await pressable(page, 'paused');
      const open = drawer(page);
      const patient = open.getByRole('combobox', { name: t.patient });
      await patient.fill('Mimoza K');
      await page.clock.runFor(300);
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      await open.getByLabel(t.start, { exact: true }).selectOption('09:00');
      await open.getByLabel(t.length, { exact: true }).selectOption('60');
      const first = open.getByText(overlapsVisit('Bojan Kamenov', '09:00', '09:30'), {
        exact: true,
      });
      const second = open.getByText(overlapsVisit('Arben Dardha', '09:30', '10:00'), {
        exact: true,
      });
      await expect(first).toBeVisible();
      await expect(second).toBeHidden();

      // Meanwhile Arben Dardha is booked at 09:30. 31 seconds on, the page is used inside the drawer:
      // the day is read again under it.
      await bookedElsewhere(day, '09:30', 30, ['Arben', 'Dardha']);
      const before = actions.length;
      await page.clock.fastForward(31_000);
      const read = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.request().headers()['next-action'] !== undefined,
      );
      const title = open.getByRole('heading', { name: t.title });
      const box = await title.boundingBox();
      if (!box) throw new Error('The drawer has no title to move the pointer over.');
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.move(box.x + 15, box.y + 5);
      await page.keyboard.press('Shift');
      await read;
      expect(actions.slice(before), 'one read').toEqual([{ path: '/calendar', booking: false }]);

      // The warning names both now; everything typed and chosen is as it was.
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      await expect(open).toBeVisible();
      await expect(patient).toHaveValue('Mimoza Kodra');
      await expect(open.getByRole('button', { name: 'Checkup', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(open.getByLabel(t.start, { exact: true })).toHaveValue('09:00');
      await expect(open.getByLabel(t.length, { exact: true })).toHaveValue('60');
      await expect(open.getByLabel(t.provider, { exact: true })).toHaveValue(
        SEEDED_PROVIDERS.harbourStreetDentist,
      );

      const book = open.getByRole('button', { name: 'Book anyway, 09:00 with Dr. Planinska' });
      await book.click();
      await expect(open).toBeHidden();
      expect(await overlapOkOn(day)).toEqual([
        ['Bojan Kamenov', '09:00', false],
        ['Mimoza Kodra', '09:00', true],
        ['Arben Dardha', '09:30', false],
      ]);
      await page.waitForLoadState('networkidle');
    } finally {
      await clear(day);
    }
  });
});

test.describe('a warning line for a break (E01-T05b, acceptance 4)', () => {
  test("a time in the provider's lunch says so; Book stays Book and books it", async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'breakLine');
    try {
      await openCalendar(page, day);
      await newAppointment(page).click();
      await pressable(page);
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill('Mimoza K');
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      const line = open.getByText("Overlaps Dr. Planinska's break: Lunch, 12:00–13:00.", {
        exact: true,
      });
      await open.getByLabel(t.start, { exact: true }).selectOption('11:30');
      await expect(line).toBeHidden();
      await open.getByLabel(t.start, { exact: true }).selectOption('12:15');
      await expect(line).toBeVisible();
      const book = open.getByRole('button', { name: /^Book / });
      await expect(book).toHaveText('Book 12:15 with Dr. Planinska');

      await book.click();
      await expect(open).toBeHidden();
      expect(await overlapOkOn(day)).toEqual([['Mimoza Kodra', '12:15', false]]);
      await page.waitForLoadState('networkidle');
    } finally {
      await clear(day);
    }
  });
});

// E01-T05c: a click on an empty slot of the grid, and a double click's second press.

/** Where a point is: its x and y on the page's window, in CSS pixels. */
interface Point {
  x: number;
  y: number;
}

/** The middle of what a locator shows. */
async function centre(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Nothing shows there to point at.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The point `offset` pixels below the top of `provider`'s column, in its middle. */
async function inColumn(page: Page, provider: string, offset: number): Promise<Point> {
  const box = await column(page, provider).boundingBox();
  if (!box) throw new Error(`No column for ${provider}.`);
  return { x: box.x + box.width / 2, y: box.y + offset };
}

/** The pixels from the grid's top (08:00 on these days) to a time of day: 1.45 a minute. */
function offsetOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return (hours * 60 + minutes - 8 * 60) * 1.45;
}

/** True when a click at the point, the drawer closed, lands on an empty slot of the grid. */
async function emptySlotAt(page: Page, at: Point): Promise<boolean> {
  return page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-slot-layer]') != null,
    at,
  );
}

/** Where a pointer's press landed: the grid's empty slot, the overlay, a part of the drawer, else. */
type Place = 'slot' | 'overlay' | 'chip' | 'select' | 'book' | 'patient' | 'drawer' | 'other';

interface Press {
  at: number;
  place: Place;
}

/**
 * From now on, each pointer's press the page gets: its time stamp (the page's own clock, which the
 * guard compares) and where it landed; and each moment the drawer went from the page, on the same
 * clock. Read with presses() and closings(), emptied with forget(). A press the guard drops still
 * reaches the document first: it is recorded in the capture phase.
 */
async function recordPresses(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = { presses: [] as { at: number; place: string }[], closings: [] as number[] };
    (window as unknown as { record: typeof record }).record = record;
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const inDrawer = (selector: string) =>
          target?.closest(`[data-slot="sheet-content"] ${selector}`) != null;
        const place =
          target === null
            ? 'other'
            : target.closest('[data-slot-layer]')
              ? 'slot'
              : target.closest('[data-slot="sheet-overlay"]')
                ? 'overlay'
                : inDrawer('[aria-pressed]')
                  ? 'chip'
                  : inDrawer('select')
                    ? 'select'
                    : inDrawer('button[type="submit"]')
                      ? 'book'
                      : inDrawer('[role="combobox"]')
                        ? 'patient'
                        : target.closest('[data-slot="sheet-content"]')
                          ? 'drawer'
                          : 'other';
        record.presses.push({ at: event.timeStamp, place });
      },
      true,
    );
    let open = document.querySelector('[data-slot="sheet-content"]') !== null;
    new MutationObserver(() => {
      const now = document.querySelector('[data-slot="sheet-content"]') !== null;
      if (open && !now) record.closings.push(performance.now());
      open = now;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
async function presses(page: Page): Promise<Press[]> {
  return page.evaluate(
    () => (window as unknown as { record: { presses: Press[] } }).record.presses,
  );
}
async function closings(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { record: { closings: number[] } }).record.closings,
  );
}
async function forget(page: Page): Promise<void> {
  await page.evaluate(() => {
    const record = (window as unknown as { record: { presses: unknown[]; closings: unknown[] } })
      .record;
    record.presses.length = 0;
    record.closings.length = 0;
  });
}

/**
 * Escape, and the drawer's closing: a click on the grid within half a second of it opens nothing
 * (E01-T05c), so the next check's click waits that long.
 */
async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
}

test.describe('a click on an empty slot (E01-T05c, acceptance 1)', () => {
  // Tall enough for the whole grid, 08:00 to 18:00, to show without scrolling.
  test.use({ viewport: { width: 1280, height: 1100 } });

  test("opens the drawer on the column's provider and the quarter hour under the pointer, the grid's first and last quarter too; a click on a visit or a break opens nothing", async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'slot');
    try {
      // Dr. Planinska's visit at 10:00; her lunch is 12:00–13:00 every weekday.
      await bookedElsewhere(day, '10:00', 30, ['Bojan', 'Kamenov']);
      await openCalendar(page, day);
      const foot = (await column(page, 'Mimoza Lumi').boundingBox())?.height ?? 0;
      expect(foot, 'the grid runs 08:00 to 18:00').toBeCloseTo(10 * 60 * 1.45, 0);
      const cases = [
        // 10:37 is in the quarter from 10:30.
        { column: 'Arben Kodra', offset: offsetOf('10:37'), start: '10:30', short: 'Dr. Kodra' },
        // The grid's first quarter, a pixel under its top.
        { column: 'Elena Planinska', offset: 1, start: '08:00', short: 'Dr. Planinska' },
        // The grid's last quarter, a pixel above its foot.
        { column: 'Mimoza Lumi', offset: foot - 1, start: '17:45', short: 'M. Lumi' },
        // Right under Dr. Planinska's visit, which ends at 10:30.
        {
          column: 'Elena Planinska',
          offset: offsetOf('10:31'),
          start: '10:30',
          short: 'Dr. Planinska',
        },
      ];
      const ids: Record<string, string> = {
        'Dr. Planinska': SEEDED_PROVIDERS.harbourStreetDentist,
        'Dr. Kodra': SEEDED_PROVIDERS.harbourStreetSecondDentist,
        'M. Lumi': SEEDED_PROVIDERS.harbourStreetHygienist,
      };
      for (const slot of cases) {
        const label = `${slot.column} at ${slot.start}`;
        const at = await inColumn(page, slot.column, slot.offset);
        expect(await emptySlotAt(page, at), `${label}: an empty slot`).toBe(true);
        await page.mouse.click(at.x, at.y);
        const open = drawer(page);
        await expect(open, label).toBeVisible();
        await expect(open.getByLabel(t.start, { exact: true }), label).toHaveValue(slot.start);
        await expect(open.getByLabel(t.provider, { exact: true }), label).toHaveValue(
          ids[slot.short] ?? '',
        );
        await expect(open.getByRole('button', { name: /^Book / }), label).toHaveText(
          `Book ${slot.start} with ${slot.short}`,
        );
        await expect(open.getByRole('combobox', { name: t.patient }), label).toBeFocused();
        await closeDrawer(page);
      }

      // A visit's block and a break's, clicked in their middle: nothing opens, nothing is booked.
      for (const block of ['li[data-status]', 'li[data-break]']) {
        const at = await centre(column(page, 'Elena Planinska').locator(block));
        await page.mouse.click(at.x, at.y);
        await page.waitForTimeout(700);
        await expect(drawer(page), block).toHaveCount(0);
      }
      expect(await bookedOn(day)).toHaveLength(1);
    } finally {
      await clear(day);
    }
  });

  test('a shaded time: on a Saturday, closed all day, the drawer opens on the slot and says the clinic is closed', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'saturday');
    await openCalendar(page, day);
    const at = await inColumn(page, 'Arben Kodra', offsetOf('09:20'));
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document.elementsFromPoint(x, y).some((element) => element.hasAttribute('data-shaded')),
        at,
      ),
      'a shaded time',
    ).toBe(true);
    await page.mouse.click(at.x, at.y);
    const open = drawer(page);
    await expect(open.getByLabel(t.start, { exact: true })).toHaveValue('09:15');
    await expect(open.getByLabel(t.provider, { exact: true })).toHaveValue(
      SEEDED_PROVIDERS.harbourStreetSecondDentist,
    );
    await expect(
      open.getByText(t.warning.noHours.replace('{weekday}', 'Saturday'), { exact: true }),
    ).toBeVisible();
    await expect(open.getByRole('button', { name: /^Book / })).toHaveText(
      'Book 09:15 with Dr. Kodra',
    );
    await closeDrawer(page);
  });
});

/** What a double click's second press may land on in the drawer, and the overlay beside it. */
type Target = 'chip' | 'select' | 'book' | 'overlay';
const TARGETS: readonly Target[] = ['chip', 'select', 'book', 'overlay'];

test.describe("a double click's second press in the drawer (E01-T05c, acceptance 2)", () => {
  // At 1280 px the drawer covers the grid's right part: the chip opens over Dr. Kodra's column, the
  // length select and Book over M. Lumi's, each over an empty slot; Dr. Planinska's column stays left
  // of it, under the overlay.
  test.use({ viewport: { width: 1280, height: 800 } });

  /**
   * Where each target opens, measured on the drawer opened once by New appointment (its entering
   * done), then closed: the Checkup chip, the length select, Book; and a point of the overlay on Dr.
   * Planinska's column, level with Book (measured before: the open drawer hides the page's roles).
   */
  async function targets(page: Page): Promise<Record<Target, Point>> {
    const left = (await centre(column(page, 'Elena Planinska'))).x;
    await newAppointment(page).click();
    const open = drawer(page);
    await expect(open).toBeVisible();
    await page.waitForTimeout(400);
    const book = await centre(open.getByRole('button', { name: /^Book / }));
    const points: Record<Target, Point> = {
      chip: await centre(open.getByRole('button', { name: 'Checkup', exact: true })),
      select: await centre(open.getByLabel(t.length, { exact: true })),
      book,
      overlay: { x: left, y: book.y },
    };
    await closeDrawer(page);
    for (const target of TARGETS) {
      expect(await emptySlotAt(page, points[target]), `${target}: over an empty slot`).toBe(true);
    }
    return points;
  }

  /**
   * Two clicks `gap` ms apart, the first at `opener`, the second at `at`, then whether the page got
   * them as a double click: less than 450 ms apart by their time stamps (the drawer opens between
   * them, so the guard's half second covers the second), a margin under the guard's 500. How far
   * apart they reached the page is the page's to say: a busy machine sends them later than asked. A
   * pair the page got further apart is marked "not checked", never passed.
   */
  async function doubleClick(
    page: Page,
    opener: Point,
    at: Point,
    gap: number,
    label: string,
  ): Promise<Press | null> {
    await forget(page);
    await page.mouse.click(opener.x, opener.y);
    await page.waitForTimeout(gap);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(700);
    const [first, second] = await presses(page);
    if (!first || !second) throw new Error(`${label}: the page got fewer than two presses.`);
    if (second.at - first.at < 450) return second;
    test.info().annotations.push({
      type: 'not checked',
      description: `${label}: the two presses reached the page ${Math.round(second.at - first.at)} ms apart`,
    });
    return null;
  }

  /**
   * How many of the twelve double clicks the page got as one, noted on the report; at least one of
   * each target, or the check proved nothing for it.
   */
  function everyTargetChecked(checked: readonly Target[]): void {
    test.info().annotations.push({
      type: 'checked',
      description: `${checked.length} of 12 double clicks`,
    });
    for (const target of TARGETS) {
      expect(checked, `a double click checked on the ${target}`).toContain(target);
    }
  }

  /** The drawer open, nothing chosen or sent, the focus in the patient field. */
  async function nothingChanged(
    page: Page,
    bookings: { booking: boolean }[],
    label: string,
  ): Promise<void> {
    const open = drawer(page);
    await expect(open, `${label}: open`).toBeVisible();
    await expect(open.locator('[aria-pressed="true"]'), `${label}: no chip pressed`).toHaveCount(0);
    await expect(open.getByLabel(t.length, { exact: true }), `${label}: the length`).toHaveValue(
      '30',
    );
    expect(
      bookings.filter((action) => action.booking),
      `${label}: nothing sent`,
    ).toEqual([]);
    await expect(
      open.getByRole('combobox', { name: t.patient }),
      `${label}: the focus in the patient field`,
    ).toBeFocused();
  }

  test('from an empty slot under it, 80, 150 and 250 ms apart: on a chip, a select, Book or the overlay, nothing is chosen or sent and the focus stays in the patient field; Escape closes it; a press half a second on picks', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'secondPress');
    const actions = countActions(page);
    await openCalendar(page, day);
    const points = await targets(page);
    await recordPresses(page);
    const checked: Target[] = [];
    for (const target of TARGETS) {
      for (const gap of [80, 150, 250]) {
        const label = `${target}, ${gap} ms`;
        // A real double click: both presses at the one point, an empty slot until the drawer opens.
        const second = await doubleClick(page, points[target], points[target], gap, label);
        if (second) {
          checked.push(target);
          expect(second.place, `${label}: the second press on the ${target}`).toBe(target);
          await nothingChanged(page, actions, label);
        }
        await closeDrawer(page);
      }
    }
    everyTargetChecked(checked);

    // A press from half a second on picks as before.
    await page.mouse.click(points.chip.x, points.chip.y);
    const open = drawer(page);
    await expect(open).toBeVisible();
    await pressable(page);
    await page.mouse.click(points.chip.x, points.chip.y);
    await expect(open.getByRole('button', { name: 'Checkup', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await closeDrawer(page);
    expect(await bookedOn(day)).toEqual([]);
  });

  test('from New appointment, 80, 150 and 250 ms apart: its second press on a chip, a select, Book or the overlay chooses and sends nothing, and the focus stays in the patient field; Escape closes it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const day = dayOf(testInfo, 'secondPress');
    const actions = countActions(page);
    await openCalendar(page, day);
    const points = await targets(page);
    const opener = await centre(newAppointment(page));
    await recordPresses(page);
    const checked: Target[] = [];
    for (const target of TARGETS) {
      for (const gap of [80, 150, 250]) {
        const label = `${target}, ${gap} ms`;
        // The second press where the target opens: New appointment sits in the header, above them.
        const second = await doubleClick(page, opener, points[target], gap, label);
        if (second) {
          checked.push(target);
          expect(second.place, `${label}: the second press on the ${target}`).toBe(target);
          await nothingChanged(page, actions, label);
        }
        await closeDrawer(page);
      }
    }
    everyTargetChecked(checked);
    expect(await bookedOn(day)).toEqual([]);
  });
});

test.describe('a double click on Book (E01-T05c, acceptance 3)', () => {
  // As in the check above: Book opens over an empty slot of M. Lumi's column.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('its answer closes the drawer before the second click, which lands on the grid: one booking, and no drawer opens again', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'bookTwice');
    const actions = countActions(page);
    try {
      await openCalendar(page, day);
      await newAppointment(page).click();
      await pressable(page);
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill('Mimoza K');
      await suggestions(open).filter({ hasText: 'Mimoza Kodra' }).click();
      await open.getByRole('button', { name: 'Checkup', exact: true }).click();
      const book = open.getByRole('button', { name: 'Book 08:00 with Dr. Planinska' });
      const at = await centre(book);
      await recordPresses(page);

      // The first click books; the second comes once the answer has closed the drawer, as soon as
      // the check sees it gone: the double click whose second click is slower than the answer.
      await page.mouse.click(at.x, at.y);
      await open.waitFor({ state: 'hidden' });
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(700);

      const [, second] = await presses(page);
      const [closed] = await closings(page);
      if (!second || closed === undefined) throw new Error('No second press, or no closing.');
      expect(second.place, 'the second click on the grid, an empty slot').toBe('slot');
      // The grid's click is dropped within half a second of the closing: by the page's clock, the
      // second press came this long after it (450 ms leaves a margin). A slower one is no double
      // click, and not checked.
      if (second.at - closed < 450) {
        await expect(drawer(page), 'no drawer opened again').toHaveCount(0);
      } else {
        testInfo.annotations.push({
          type: 'not checked',
          description: `the second press came ${Math.round(second.at - closed)} ms after the closing`,
        });
      }
      await page.waitForLoadState('networkidle');
      expect(
        actions.filter((action) => action.booking),
        'one booking request',
      ).toHaveLength(1);
      expect(await bookedOn(day)).toMatchObject([
        {
          patient: 'Mimoza Kodra',
          provider_id: SEEDED_PROVIDERS.harbourStreetDentist,
          starts: '08:00',
        },
      ]);
    } finally {
      await clear(day);
    }
  });
});

// E01-T05c tester: a click on the grid within half a second of the drawer closing opens nothing,
// whatever closed it (new-appointment.tsx, closedAt): a double click outside the drawer, whose first
// click closes it and whose second lands on the grid, and a click right after Escape.
test.describe('a click on the grid right after the drawer closed (E01-T05c, tester)', () => {
  // As in the second-press checks: Dr. Planinska's column stays left of the drawer, under the overlay.
  test.use({ viewport: { width: 1280, height: 800 } });

  /** Whether the press came under 450 ms after the closing, by the page's clock; else noted. */
  async function withinClosing(page: Page, label: string): Promise<boolean> {
    const [second] = (await presses(page)).filter((press) => press.place === 'slot');
    const [closed] = await closings(page);
    if (!second || closed === undefined)
      throw new Error(`${label}: no press on the grid, or no closing.`);
    if (second.at - closed < 450) return true;
    test.info().annotations.push({
      type: 'not checked',
      description: `${label}: the press came ${Math.round(second.at - closed)} ms after the closing`,
    });
    return false;
  }

  test('a double click outside it, 80, 150 and 250 ms apart: the first closes it, the second lands on the grid and opens nothing; nor does a click at once after Escape; from half a second on it opens', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'closeTwice');
    const actions = countActions(page);
    await openCalendar(page, day);
    const outside = await inColumn(page, 'Elena Planinska', offsetOf('14:07'));
    await recordPresses(page);
    let checked = 0;
    for (const gap of [80, 150, 250]) {
      const label = `outside, ${gap} ms`;
      await newAppointment(page).click();
      await expect(drawer(page)).toBeVisible();
      await pressable(page);
      await forget(page);
      await page.mouse.click(outside.x, outside.y);
      await page.waitForTimeout(gap);
      await page.mouse.click(outside.x, outside.y);
      await page.waitForTimeout(700);
      expect(
        (await presses(page)).map((press) => press.place),
        label,
      ).toEqual(['overlay', 'slot']);
      if (await withinClosing(page, label)) {
        checked += 1;
        await expect(drawer(page), `${label}: no drawer opened`).toHaveCount(0);
      } else if ((await drawer(page).count()) > 0) {
        await closeDrawer(page);
      }
      await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
    }

    // Escape, then at once a click on the grid.
    await newAppointment(page).click();
    await expect(drawer(page)).toBeVisible();
    await forget(page);
    await page.keyboard.press('Escape');
    await page.mouse.click(outside.x, outside.y);
    await page.waitForTimeout(700);
    if (await withinClosing(page, 'Escape')) {
      checked += 1;
      await expect(drawer(page), 'Escape: no drawer opened').toHaveCount(0);
    } else if ((await drawer(page).count()) > 0) {
      await closeDrawer(page);
    }
    testInfo.annotations.push({ type: 'checked', description: `${checked} of 4 closings` });
    expect(checked, 'at least one click on the grid checked within half a second').toBeGreaterThan(
      0,
    );

    // From half a second after the closing, the grid's click opens the drawer on its slot.
    await page.waitForTimeout(DOUBLE_CLICK_MS + 100);
    await page.mouse.click(outside.x, outside.y);
    const open = drawer(page);
    await expect(open.getByLabel(t.start, { exact: true })).toHaveValue('14:00');
    await expect(open.getByLabel(t.provider, { exact: true })).toHaveValue(
      SEEDED_PROVIDERS.harbourStreetDentist,
    );
    await closeDrawer(page);
    expect(actions.filter((action) => action.booking)).toEqual([]);
    expect(await bookedOn(day)).toEqual([]);
  });
});

test.describe('a new patient booked in one go (E01-T05d, acceptance 1, 2, 3 and 6)', () => {
  /** Each browser's own new patient, so no browser finds another's. Invented names. */
  const LAST_NAMES: Record<string, string> = {
    chromium: 'Trajkovska',
    firefox: 'Kostovska',
    webkit: 'Shehu',
  };

  test('"Add … as new patient" by pointer and by keyboard, back to the search, then Book: one patient, one visit', async ({
    page,
  }, testInfo) => {
    const day = dayOf(testInfo, 'newPatient');
    const lastName = LAST_NAMES[testInfo.project.name] ?? 'Trajkovska';
    const typed = `Vesna ${lastName}`;
    const addNew = t.addNewPatient.replace('{text}', typed);
    const fields = messages.newPatient;
    // Every address the page asks for: the new patient's words are in none (D-095).
    const addresses: string[] = [];
    page.on('request', (sent) => addresses.push(sent.url()));
    try {
      await openCalendar(page, day);
      await newAppointment(page).click();
      const open = drawer(page);
      const patient = open.getByRole('combobox', { name: t.patient });
      await expect(patient).toBeFocused();
      await pressable(page);

      // By pointer: the last option, whatever the search finds.
      await patient.fill(typed);
      const option = suggestions(open).last();
      await expect(option).toHaveText(addNew);
      await option.click();
      const firstName = open.getByLabel(fields.firstName, { exact: true });
      await expect(firstName, 'the focus in the first name').toBeFocused();
      await expect(firstName).toHaveValue('Vesna');
      await expect(open.getByLabel(fields.lastName, { exact: true })).toHaveValue(lastName);
      await expect(open.getByText(t.unreachable)).toBeVisible();

      // Back to the search: the text typed in it again.
      await open.getByRole('button', { name: t.backToSearch }).click();
      await expect(patient).toHaveValue(typed);
      await expect(patient).toBeFocused();

      // By keyboard: up from none is the last option; Enter takes it.
      await expect(suggestions(open).last()).toHaveText(addNew);
      await page.keyboard.press('ArrowUp');
      await expect(suggestions(open).last()).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Enter');
      await expect(firstName).toBeFocused();
      await expect(firstName).toHaveValue('Vesna');

      // A phone: the line goes. A treatment, then Book.
      await open.getByLabel(fields.phone, { exact: true }).fill('070 001 461');
      await expect(open.getByText(t.unreachable)).toBeHidden();
      await open.getByRole('button', { name: 'Filling', exact: true }).click();
      await open.getByRole('button', { name: 'Book 08:00 with Dr. Planinska' }).click();

      await expect(open).toBeHidden();
      await expect(
        page
          .getByRole('region', { name: 'Notifications (F8)' })
          .getByText(`Booked ${typed}, 08:00.`, { exact: true }),
      ).toBeVisible();
      await expect(column(page, 'Elena Planinska').locator('li[data-status]')).toContainText(typed);
      expect(await bookedOn(day)).toEqual([
        {
          patient: typed,
          provider_id: SEEDED_PROVIDERS.harbourStreetDentist,
          title: 'Filling',
          starts: '08:00',
          minutes: 45,
          status: 'booked',
        },
      ]);
      const added = await db.query<{ id: string; phone_e164: string | null; created: string }>(
        `select p.id, p.phone_e164,
                (select count(*) from audit_log a
                  where a.entity_id = p.id::text and a.action = 'patient.created')::text as created
           from patients p where p.clinic_id = $1 and p.first_name = 'Vesna' and p.last_name = $2`,
        [SEEDED_CLINICS.harbourStreet, lastName],
      );
      expect(added.rows.map((row) => [row.phone_e164, row.created])).toEqual([
        ['+38970001461', '1'],
      ]);
      expect(
        addresses.filter((address) => address.includes(lastName) || address.includes('Vesna')),
      ).toEqual([]);
    } finally {
      await clear(day);
      await db.query(
        `delete from patients where clinic_id = $1 and first_name = 'Vesna' and last_name = $2`,
        [SEEDED_CLINICS.harbourStreet, lastName],
      );
    }
  });
});
