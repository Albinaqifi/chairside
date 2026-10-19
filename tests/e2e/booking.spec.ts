import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import pg from 'pg';
import { SEEDED_CLINICS, SEEDED_PROVIDERS } from '@/db/seed/seeded';
import messages from '@/i18n/en.json' with { type: 'json' };
import { e2eDatabase } from './e2e-database.ts';
import { APP } from './servers.ts';

// E01-T05a in real browsers, on the production build, as the seeded front desk (the global setup's
// session; no sign-in of its own): booking an existing patient from New appointment, with the mouse
// and with the keyboard alone; the block on the grid at once, in its provider's column also when the
// filter had it off; one booking for a double click on Book; a read on use while the drawer is open
// (the browser's clock moved); a double click on New appointment. Each check books on a day of its
// browser's own, in April 2031, far from the seed's week and from calendar.spec.ts's March days, so no
// other check's counts change; it removes what it booked. Names are the seed's invented ones.

const t = messages.calendar.booking;

/** The days each browser books on, one a check: weekdays, open 08:00–18:00 like every weekday. */
const DAYS: Record<
  string,
  Record<'mouse' | 'keyboard' | 'filter' | 'twice' | 'read' | 'words', string>
> = {
  chromium: {
    mouse: '2031-04-07',
    keyboard: '2031-04-08',
    filter: '2031-04-09',
    twice: '2031-04-10',
    read: '2031-04-11',
    words: '2031-04-28', // the tester's (acceptance 8)
  },
  firefox: {
    mouse: '2031-04-14',
    keyboard: '2031-04-15',
    filter: '2031-04-16',
    twice: '2031-04-17',
    read: '2031-04-18',
    words: '2031-04-29',
  },
  webkit: {
    mouse: '2031-04-21',
    keyboard: '2031-04-22',
    filter: '2031-04-23',
    twice: '2031-04-24',
    read: '2031-04-25',
    words: '2031-04-30',
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
      // Filled in: the day's opening (not the clinic's today), 30 minutes, the first column shown.
      await expect(open.getByLabel(t.start, { exact: true })).toHaveValue('08:00');
      await expect(open.getByLabel(t.length, { exact: true })).toHaveValue('30');
      await expect(open.getByLabel(t.provider, { exact: true })).toHaveValue(
        SEEDED_PROVIDERS.harbourStreetDentist,
      );

      // 1. Type part of the name. 2. Pick them.
      await patient.fill('Mimoza K');
      const suggestion = suggestions(open).filter({ hasText: 'Mimoza Kodra' });
      await expect(suggestions(open)).toHaveCount(1);
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
      await expect(suggestions(open)).toHaveCount(1);
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
      const open = drawer(page);
      await open.getByRole('combobox', { name: t.patient }).fill(typed);
      await expect(suggestions(open)).toHaveCount(1);
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
