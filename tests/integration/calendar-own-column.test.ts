import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCalendarDay } from '@/app/(staff)/calendar/actions';
import { CalendarScreen } from '@/app/(staff)/calendar/calendar-screen';
import type { CalendarRead } from '@/app/(staff)/calendar/day';
import { firstChoice, shownColumns } from '@/app/(staff)/calendar/filter';
import CalendarPage from '@/app/(staff)/calendar/page';
import { closeDb } from '@/db/client';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { createStaffUser } from '@/modules/auth';
import { insertClinic, insertMembership, migratorPool, signInCookie, testEmail } from './fixtures';
import { insertProvider } from './scheduling-fixtures';

// E01-T04b, acceptance 2: the calendar's read gives the provider the reader's membership is linked
// to (memberships.provider_id), read in the clinic's own transaction, and the calendar opens on that
// column alone; a member linked to none opens on all. As each role, through the page as Next.js calls
// it and through the read as the browser calls it, with its clinic check. Only Next.js's request
// functions and next-intl's server side are replaced, as there is no running Next.js. The seed's own
// logins: tests/integration/seed.test.ts. Every value is synthetic.

const PASSWORD = 'MARKER-pw-4c7e-correct';
const DAY = '2026-10-26';

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
let clinic: string;
let otherClinic: string;
const column = {} as Record<'dentist' | 'secondDentist' | 'hygienist', string>;
const email = {} as Record<'owner' | 'dentist' | 'hygienist' | 'frontDesk', string>;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.47.0.${nextAddress++}`;

async function person(
  who: keyof typeof email,
  memberships: { clinicId: string; role: string; providerId?: string }[],
): Promise<void> {
  email[who] = testEmail();
  const { id } = await createStaffUser({ email: email[who], name: 'Staff', password: PASSWORD });
  for (const membership of memberships)
    await insertMembership(admin, { ...membership, userId: id });
}

/** Every element of `type` in a tree of elements, without calling any component in it. */
function elementsOf<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as ReactElement<P>] : [];
  return [...own, ...elementsOf<P>(node.props.children, type)];
}

/** Signs `who` in, in `clinicId`. */
async function signedIn(who: keyof typeof email, clinicId: string): Promise<void> {
  request.cookie = await signInCookie(email[who], PASSWORD, freshAddress());
  request.clinic = clinicId;
}

/** What the page hands the calendar in the browser. */
async function pageRead(): Promise<CalendarRead> {
  const shown = await CalendarPage({ searchParams: Promise.resolve({ day: DAY }) });
  const screens = elementsOf<{ initial: CalendarRead }>(shown, CalendarScreen);
  expect(screens).toHaveLength(1);
  return screens[0]!.props.initial;
}

/** The columns the calendar opens on, from what the read gave. */
function opensOn(read: CalendarRead): string[] {
  return shownColumns(
    firstChoice(read.ownProviderId),
    read.view.columns.map((found) => found.providerId),
  );
}

beforeAll(async () => {
  [clinic, otherClinic] = [await insertClinic(admin), await insertClinic(admin)];
  column.dentist = await insertProvider(admin, clinic, 'dentist');
  column.secondDentist = await insertProvider(admin, clinic, 'dentist');
  column.hygienist = await insertProvider(admin, clinic, 'hygienist');
  await person('owner', [{ clinicId: clinic, role: 'owner' }]);
  await person('dentist', [
    { clinicId: clinic, role: 'dentist', providerId: column.dentist },
    { clinicId: otherClinic, role: 'front_desk' },
  ]);
  await person('hygienist', [
    { clinicId: clinic, role: 'hygienist', providerId: column.hygienist },
  ]);
  await person('frontDesk', [{ clinicId: clinic, role: 'front_desk' }]);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  request.cookie = '';
  request.clinic = undefined;
});

describe('the column each member opens on, as the page reads it', () => {
  it('the dentist and the hygienist: their own column alone', async () => {
    await signedIn('dentist', clinic);
    const dentist = await pageRead();
    expect(dentist.ownProviderId).toBe(column.dentist);
    expect(dentist.view.columns).toHaveLength(3);
    expect(opensOn(dentist)).toEqual([column.dentist]);

    await signedIn('hygienist', clinic);
    const hygienist = await pageRead();
    expect(hygienist.ownProviderId).toBe(column.hygienist);
    expect(opensOn(hygienist)).toEqual([column.hygienist]);
  });

  it('the owner and the front desk: every column', async () => {
    for (const who of ['owner', 'frontDesk'] as const) {
      await signedIn(who, clinic);
      const read = await pageRead();
      expect(read.ownProviderId, who).toBeNull();
      expect(opensOn(read), who).toEqual(read.view.columns.map((found) => found.providerId));
      expect(opensOn(read), who).toHaveLength(3);
    }
  });

  it("a link in one clinic is not the member's in another: there, every column", async () => {
    await signedIn('dentist', otherClinic);
    expect((await pageRead()).ownProviderId).toBeNull();
  });
});

describe('the read as the browser calls it on use, with its clinic check', () => {
  it("gives the linked provider with the day, in the frame's clinic", async () => {
    await signedIn('dentist', clinic);
    const answer = await readCalendarDay(clinic, { day: DAY });
    expect(answer).toMatchObject({ ok: true, value: { ownProviderId: column.dentist } });
  });

  it('another clinic than the one the request resolves to: clinic_changed, nothing read', async () => {
    await signedIn('dentist', clinic);
    expect(await readCalendarDay(otherClinic, { day: DAY })).toEqual({
      ok: false,
      error: { code: 'clinic_changed' },
    });
  });
});
