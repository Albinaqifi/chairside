import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageClinic } from '@/app/_lib/frame-clinic';
import type { CalendarDayView } from '@/app/(staff)/calendar/day';
import { DayCalendar } from '@/app/(staff)/calendar/day-calendar';
import CalendarPage from '@/app/(staff)/calendar/page';
import { closeDb } from '@/db/client';
import { dayInZone } from '@/lib/calendar-day';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import {
  insertClinic,
  insertMembership,
  migratorPool,
  redirectOf,
  signInCookie,
  testEmail,
} from './fixtures';
import { insertRow } from './scheduling-fixtures';

// E01-T04a, acceptance 6: the calendar page as Next.js calls it, with the day its address asks for:
// the page reads `?day=`, the read's wrapper checks who asks and opens the clinic's transaction, and
// the day comes back laid out. Anything but one day of the calendar is the clinic's today. Only
// Next.js's request functions and next-intl's server side are replaced, as there is no running
// Next.js; the view is read from the element the page returns, never rendered (the page's own
// render is src/app/(staff)/calendar/day-calendar.test.ts). Every value is synthetic.

const PASSWORD = 'MARKER-pw-9e3b-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

const admin = migratorPool();
let firstClinic: string;
let secondClinic: string;
let firstProvider: string;
let secondProvider: string;
let twoClinics: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.46.0.${nextAddress++}`;

/** Every element of `type` in a tree of elements, without calling any component in it. */
function elementsOf<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as ReactElement<P>] : [];
  return [...own, ...elementsOf<P>(node.props.children, type)];
}

/** The page for this address's `day`, as Next.js passes it: the view it shows, and its clinic. */
async function page(
  day?: string | string[],
): Promise<{ view: CalendarDayView; clinics: unknown[] }> {
  const shown = await CalendarPage({
    searchParams: Promise.resolve(day === undefined ? {} : { day }),
  });
  const views = elementsOf<{ view: CalendarDayView }>(shown, DayCalendar);
  expect(views).toHaveLength(1);
  return {
    view: views[0]!.props.view,
    clinics: elementsOf<{ clinicId: unknown }>(shown, PageClinic).map((e) => e.props.clinicId),
  };
}

/** The clinic's today in Skopje, either side of the call: a run at midnight sees one of the two. */
async function todayAround<T>(call: () => Promise<T>): Promise<{ result: T; days: string[] }> {
  const before = dayInZone(new Date(), 'Europe/Skopje');
  const result = await call();
  return { result, days: [before, dayInZone(new Date(), 'Europe/Skopje')] };
}

beforeAll(async () => {
  firstClinic = await insertClinic(admin);
  secondClinic = await insertClinic(admin);
  for (const [clinicId, set] of [
    [firstClinic, (id: string) => (firstProvider = id)],
    [secondClinic, (id: string) => (secondProvider = id)],
  ] as const) {
    const id = newId();
    await insertRow(admin, 'providers', {
      id,
      clinic_id: clinicId,
      name: 'Elena Planinska',
      short_name: 'Dr. Planinska',
      kind: 'dentist',
      chair_label: 'Chair 1',
      color_hue: 195,
    });
    set(id);
  }
  twoClinics = testEmail();
  const { id } = await createStaffUser({
    email: twoClinics,
    name: 'Front desk',
    password: PASSWORD,
  });
  await insertMembership(admin, { clinicId: firstClinic, userId: id });
  await insertMembership(admin, { clinicId: secondClinic, userId: id });
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  request.cookie = '';
  request.clinic = undefined;
});

describe('the calendar page checks the session itself', () => {
  it('signed out: to the login page; a member of two clinics who has not chosen one: to the picker', async () => {
    expect(await redirectOf(page('2026-10-26'))).toBe('/login');
    request.cookie = await signInCookie(twoClinics, PASSWORD, freshAddress());
    expect(await redirectOf(page('2026-10-26'))).toBe('/choose-clinic');
  });
});

describe('the day the address asks for, in the chosen clinic (acceptance 6)', () => {
  beforeEach(async () => {
    request.cookie = await signInCookie(twoClinics, PASSWORD, freshAddress());
  });

  it('a day of the calendar: that day, with the day before and after', async () => {
    request.clinic = firstClinic;
    const { view, clinics } = await page('2026-10-26');
    expect(view).toMatchObject({ day: '2026-10-26', previous: '2026-10-25', next: '2026-10-27' });
    expect(clinics).toEqual([firstClinic]);
  });

  it.each([
    { what: 'no day', day: undefined },
    { what: 'a day the month lacks', day: '2026-02-30' },
    { what: 'a word', day: 'tomorrow' },
    { what: 'two days', day: ['2026-10-26', '2026-10-27'] },
    { what: 'the year 0', day: '0000-12-31' },
  ])("$what: the clinic's today", async ({ day }) => {
    request.clinic = firstClinic;
    const { result, days } = await todayAround(() => page(day));
    expect(days).toContain(result.view.day);
    expect(result.view.today).toBe(result.view.day);
  });

  it("each clinic's own columns, as the member chose it", async () => {
    for (const [chosen, provider] of [
      [firstClinic, firstProvider],
      [secondClinic, secondProvider],
    ] as const) {
      request.clinic = chosen;
      const { view, clinics } = await page('2026-10-26');
      expect(view.columns.map((column) => column.providerId)).toEqual([provider]);
      expect(clinics).toEqual([chosen]);
    }
  });
});
