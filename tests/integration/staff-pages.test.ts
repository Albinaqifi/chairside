import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import { FrameClinic, PageClinic } from '@/app/_lib/frame-clinic';
import AutomationsPage from '@/app/(staff)/automations/page';
import CalendarPage from '@/app/(staff)/calendar/page';
import ComponentsPage from '@/app/(staff)/dev/components/page';
import ImportPage from '@/app/(staff)/import/page';
import StaffLayout from '@/app/(staff)/layout';
import { NAVIGATION } from '@/app/(staff)/navigation';
import TodayPage from '@/app/(staff)/page';
import { NewPatientForm } from '@/app/(staff)/patients/new/new-patient-form';
import NewPatientPage from '@/app/(staff)/patients/new/page';
import PatientsPage from '@/app/(staff)/patients/page';
import { PatientList } from '@/app/(staff)/patients/patient-list';
import { PlaceholderPage } from '@/app/(staff)/placeholder-page';
import { ClinicDetailsForm } from '@/app/(staff)/settings/clinic-details-form';
import { OpeningHoursForm } from '@/app/(staff)/settings/opening-hours-form';
import SettingsPage from '@/app/(staff)/settings/page';
import { Sidebar } from '@/app/(staff)/sidebar';
import VisitPage from '@/app/(staff)/visit/page';
import { closeDb } from '@/db/client';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { createStaffUser } from '@/modules/auth';
import { config } from '@/proxy';
import {
  insertClinic,
  insertMembership,
  migratorPool,
  ORIGIN,
  redirectOf,
  signInCookie,
  testEmail,
} from './fixtures';
import { insertRow } from './scheduling-fixtures';

// E00-T04b, acceptance 4: every placeholder page checks the session itself, as Today does: the
// request proxy is not the check (security-privacy.md, section 2). Each page is called as Next.js
// calls it while rendering; only next/headers and next-intl's server side are replaced, as there is
// no running Next.js. The tester checks the browser's side. Every value is synthetic.

const PASSWORD = 'MARKER-pw-6c2f-correct';

// What the request carries: the session cookie, and the clinic picked earlier.
const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

// The pages' texts come from next-intl, which only a running Next.js configures: each is its key.
// E01-T08a: the Settings page names its countries and currencies in the request's locale.
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
  getLocale: () => Promise.resolve('en'),
}));

/** Every staff page, by the path it is served at. */
const PAGES: Record<string, () => Promise<ReactNode>> = {
  '/': TodayPage,
  '/calendar': CalendarPage,
  '/visit': VisitPage,
  '/patients': PatientsPage,
  '/automations': AutomationsPage,
  '/import': ImportPage,
  '/settings': SettingsPage,
};

/**
 * Where a page sent the person with Next.js's redirect(), 'not found' when it answered with
 * notFound() (E01-T08a: Settings, to anyone but an owner), or undefined when it rendered.
 */
async function outcomeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    return await redirectOf(call);
  } catch (error) {
    if ((error as { digest?: unknown } | null)?.digest === 'NEXT_HTTP_ERROR_FALLBACK;404') {
      return 'not found';
    }
    throw error;
  }
}

/** Where each page, and the layout around them, sent the person; undefined where it rendered. */
async function whereEachGoes(): Promise<Record<string, string | undefined>> {
  const outcome: Record<string, string | undefined> = {};
  for (const [path, page] of Object.entries(PAGES)) outcome[path] = await outcomeOf(page());
  outcome.layout = await outcomeOf(StaffLayout({ children: null }));
  return outcome;
}

/** The same answer for every page and the layout. */
const everywhere = (answer: string | undefined) =>
  Object.fromEntries([...Object.keys(PAGES), 'layout'].map((key) => [key, answer]));

/**
 * What a front-desk member gets: every page and the layout render, but Settings, the owner's
 * alone, answers "not found" (E01-T08a; the owner's yes to this change, 2026-10-12).
 */
const forFrontDesk = () => ({ ...everywhere(undefined), '/settings': 'not found' });

const admin = migratorPool();
let firstClinic: string;
let secondClinic: string;
let oneClinic: { email: string; clinicId: string };
let twoClinics: { email: string };
let noClinic: { email: string };

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.36.0.${nextAddress++}`;

/** A synthetic member of the given clinics, named with a role word. */
async function member(clinics: string[]): Promise<{ email: string }> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Front desk', password: PASSWORD });
  for (const clinicId of clinics) await insertMembership(admin, { clinicId, userId: id });
  return { email };
}

beforeAll(async () => {
  firstClinic = await insertClinic(admin);
  secondClinic = await insertClinic(admin);
  oneClinic = { ...(await member([firstClinic])), clinicId: firstClinic };
  twoClinics = await member([firstClinic, secondClinic]);
  noClinic = await member([]);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

beforeEach(() => {
  request.cookie = '';
  request.clinic = undefined;
});

describe('every staff page checks the session itself (E00-T04b, acceptance 4)', () => {
  it('has a page for every item of the navigation, and no other', () => {
    expect(Object.keys(PAGES).sort()).toEqual(NAVIGATION.map((item) => item.path).sort());
  });

  it('signed out: every page and the layout send the person to the login page', async () => {
    expect(await whereEachGoes()).toEqual(everywhere('/login'));
  });

  it('with a session cookie that names no session: the same', async () => {
    request.cookie = 'chairside.session_token=not-a-session.not-a-signature';
    expect(await whereEachGoes()).toEqual(everywhere('/login'));
  });

  it('a member of two clinics who has not chosen one: to the clinic picker', async () => {
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    expect(await whereEachGoes()).toEqual(everywhere('/choose-clinic'));
  });

  it('a member of two clinics whose cookie names a clinic they are not in: to the clinic picker', async () => {
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    request.clinic = await insertClinic(admin);
    expect(await whereEachGoes()).toEqual(everywhere('/choose-clinic'));
  });

  it('a person with no clinic: to the clinic picker, which says so', async () => {
    request.cookie = await signInCookie(noClinic.email, PASSWORD, freshAddress());
    expect(await whereEachGoes()).toEqual(everywhere('/choose-clinic'));
  });

  it('a member of one clinic: every page and the layout render', async () => {
    request.cookie = await signInCookie(oneClinic.email, PASSWORD, freshAddress());
    expect(await whereEachGoes()).toEqual(forFrontDesk());
  });

  it('a member of two clinics who chose one: every page and the layout render', async () => {
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    request.clinic = secondClinic;
    expect(await whereEachGoes()).toEqual(forFrontDesk());
  });
});

describe('the request proxy runs for every path of the navigation', () => {
  // A staff path never starts with `login` and holds no dot: the proxy's matcher skips such paths
  // (CLAUDE.md, next to src/proxy.ts). The pages still check the session themselves (above).
  it.each(NAVIGATION.map((item) => item.path))('%s', (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}` })).toBe(true);
  });

  it('and skips the paths the rule names, so the check above can fail', () => {
    for (const path of ['/login', '/login-history', '/patients.csv', '/settings/v1.2']) {
      expect(unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}` }), path).toBe(false);
    }
  });
});

// E00-T04c, tester: the clinic id every staff form sends is the frame's (D-069, D-092), and the
// staff layout is the frame's one source: it fills FrameClinic with the clinic of the request, the
// one its sidebar names, and each page renders PageClinic with the clinic it was rendered for, so
// a frame that names another catches up. Read from the elements the layout and the pages return;
// no component in them is called but the placeholder page, a server component.

/** Every element of `type` in a tree of elements, without calling any component in it. */
function elementsOf<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const own = node.type === type ? [node as ReactElement<P>] : [];
  return [...own, ...elementsOf<P>(node.props.children, type)];
}

/** The clinic id the staff layout's frame names, and the clinic its sidebar was given. */
async function frameOfLayout(): Promise<{ frame: unknown; sidebars: string[] }> {
  const layout = await StaffLayout({ children: null });
  if (!isValidElement<{ clinicId?: unknown }>(layout) || layout.type !== FrameClinic) {
    throw new Error('the staff layout does not start with FrameClinic');
  }
  const sidebars = elementsOf<{ staff: Staff }>(layout, Sidebar);
  return {
    frame: layout.props.clinicId,
    sidebars: sidebars.map((s) => s.props.staff.clinic.clinicId),
  };
}

/**
 * The clinic ids a page hands PageClinic: a placeholder page's, or (E01-T02a) those in the tree a
 * built page returns, as /dev/components below.
 */
async function pageClinicsOf(page: () => Promise<ReactNode>): Promise<unknown[]> {
  const shown = await page();
  const rendered =
    isValidElement<{ heading: string }>(shown) && shown.type === PlaceholderPage
      ? await PlaceholderPage(shown.props)
      : shown;
  return elementsOf<{ clinicId: unknown }>(rendered, PageClinic).map((e) => e.props.clinicId);
}

describe('the frame names the clinic of the request, and each page the clinic it was rendered for (E00-T04c)', () => {
  it.each(['first', 'second'] as const)(
    'a member of two clinics who chose the %s one: that clinic, in the frame, the sidebar and every page',
    async (which) => {
      const chosen = which === 'first' ? firstClinic : secondClinic;
      request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
      request.clinic = chosen;
      expect(await frameOfLayout()).toEqual({ frame: chosen, sidebars: [chosen] });
      for (const [path, page] of Object.entries(PAGES)) {
        // Settings is the owner's alone: "not found" for this front-desk member (E01-T08a). Its
        // frame check as an owner is below.
        if (path === '/settings') expect(await outcomeOf(page()), path).toBe('not found');
        else expect(await pageClinicsOf(page), path).toEqual([chosen]);
      }
      const components = await ComponentsPage();
      const ids = elementsOf<{ clinicId: unknown }>(components, PageClinic).map(
        (e) => e.props.clinicId,
      );
      expect(ids, '/dev/components').toEqual([chosen]);
    },
  );

  it('a member of one clinic: that clinic', async () => {
    request.cookie = await signInCookie(oneClinic.email, PASSWORD, freshAddress());
    expect(await frameOfLayout()).toEqual({
      frame: oneClinic.clinicId,
      sidebars: [oneClinic.clinicId],
    });
  });
});

// E01-T02a, critical review: after another tab chose another clinic, Patients clicked on
// /patients, the address already open, renders the page again in place, and React keeps a
// component's state while its element keeps its type, its place and its key. So the patient list
// is keyed by the clinic its page was rendered for: a render for another clinic gets another key,
// and React starts a new list with that render's rows and an empty box, never the first clinic's
// rows under the second clinic's name. Read from the elements the page returns, as PageClinic
// above; the browser's side is the tester's.

describe('the patient list is keyed by the clinic its page was rendered for (E01-T02a)', () => {
  /** One patient in each of the two clinics, by clinic id: each render's rows are its clinic's. */
  const patientOf = new Map<string, string>();

  beforeAll(async () => {
    const firstNames = new Map([
      [firstClinic, 'Elena'],
      [secondClinic, 'Marko'],
    ]);
    for (const [clinicId, firstName] of firstNames) {
      const id = newId();
      await insertRow(admin, 'patients', {
        id,
        clinic_id: clinicId,
        first_name: firstName,
        last_name: 'Kodra',
        language: 'en',
      });
      patientOf.set(clinicId, id);
    }
  });

  it("a member of two clinics: each render's list keyed by its clinic, with that clinic's rows", async () => {
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    for (const [which, chosen] of [
      ['first', firstClinic],
      ['second', secondClinic],
    ] as const) {
      request.clinic = chosen;
      const lists = elementsOf<ComponentProps<typeof PatientList>>(
        await PatientsPage(),
        PatientList,
      );
      const shown = lists.map((list) => ({
        key: list.key,
        rows: list.props.initial.rows.map((row) => row.id),
      }));
      expect(shown, `rendered for the ${which} clinic`).toEqual([
        { key: chosen, rows: [patientOf.get(chosen)] },
      ]);
    }
  });
});

// E01-T02b: the new-patient page is no item of the navigation, so the cases above do not reach it.
// It checks the session itself, as every staff page does, renders PageClinic with the clinic it was
// rendered for, and keys its form by that clinic (D-098): a render for another clinic starts an
// empty form, never one holding what was typed for the first.

describe('the new-patient page (E01-T02b)', () => {
  it('signed out: to the login page; a member of two clinics who has not chosen one: to the picker', async () => {
    expect(await redirectOf(NewPatientPage())).toBe('/login');
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    expect(await redirectOf(NewPatientPage())).toBe('/choose-clinic');
  });

  it('a member of two clinics who chose one: PageClinic and the form, keyed by that clinic', async () => {
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    for (const chosen of [firstClinic, secondClinic]) {
      request.clinic = chosen;
      const page = await NewPatientPage();
      const clinics = elementsOf<{ clinicId: unknown }>(page, PageClinic).map(
        (e) => e.props.clinicId,
      );
      expect(clinics).toEqual([chosen]);
      expect(elementsOf(page, NewPatientForm).map((form) => form.key)).toEqual([chosen]);
    }
  });
});

// E01-T08a, acceptance 3: Settings is the owner's alone (settings.manage). Anyone else gets "not
// found", as the new-patient page answers; the owner gets the page, with PageClinic for the clinic it
// was rendered for and the Clinic tab's form keyed by that clinic, filled from its row (D-098).

describe('the Settings page (E01-T08a)', () => {
  /** A synthetic member with this role in the given clinics, named with a role word; their email. */
  async function memberAs(role: string, clinics: string[]): Promise<string> {
    const email = testEmail();
    const { id } = await createStaffUser({ email, name: 'Owner', password: PASSWORD });
    for (const clinicId of clinics) await insertMembership(admin, { clinicId, userId: id, role });
    return email;
  }

  it.each(['dentist', 'hygienist', 'front_desk'])(
    'as a %s of the clinic: not found, and the frame still renders',
    async (role) => {
      request.cookie = await signInCookie(
        await memberAs(role, [firstClinic]),
        PASSWORD,
        freshAddress(),
      );
      expect(await outcomeOf(SettingsPage())).toBe('not found');
      expect(await outcomeOf(StaffLayout({ children: null }))).toBeUndefined();
    },
  );

  it('signed out: to the login page; an owner of two clinics who has not chosen one: to the picker', async () => {
    expect(await outcomeOf(SettingsPage())).toBe('/login');
    request.cookie = await signInCookie(
      await memberAs('owner', [firstClinic, secondClinic]),
      PASSWORD,
      freshAddress(),
    );
    expect(await outcomeOf(SettingsPage())).toBe('/choose-clinic');
  });

  it('an owner of two clinics who chose one: PageClinic and the form, keyed by that clinic, filled from its row', async () => {
    request.cookie = await signInCookie(
      await memberAs('owner', [firstClinic, secondClinic]),
      PASSWORD,
      freshAddress(),
    );
    for (const chosen of [firstClinic, secondClinic]) {
      request.clinic = chosen;
      const page = await SettingsPage();
      const clinics = elementsOf<{ clinicId: unknown }>(page, PageClinic).map(
        (e) => e.props.clinicId,
      );
      expect(clinics).toEqual([chosen]);
      const forms = elementsOf<ComponentProps<typeof ClinicDetailsForm>>(page, ClinicDetailsForm);
      expect(forms.map((form) => form.key)).toEqual([chosen]);
      const { rows } = await admin.query<{ name: string }>(
        'select name from clinics where id = $1',
        [chosen],
      );
      expect(forms[0]?.props.values).toMatchObject({
        name: rows[0]?.name,
        timeZone: 'Europe/Skopje',
        country: 'MK',
      });
      expect(forms[0]?.props.choices.timeZones.areas.length).toBeGreaterThan(5);
    }
  });

  // E01-T08b, acceptance 1 and 5: the Opening hours tab's form keyed by the clinic and filled from
  // its rows, a weekday off the 15-minute steps as it is stored; the Clinic tab's phone with its
  // country code (D-111). The page's values, as the forms are handed them.
  it('an owner: the Opening hours form keyed by the clinic, filled from its rows; the phone with its country code', async () => {
    request.cookie = await signInCookie(
      await memberAs('owner', [firstClinic, secondClinic]),
      PASSWORD,
      freshAddress(),
    );
    await admin.query(`update clinics set phone = '+38970001402' where id = $1`, [firstClinic]);
    await admin.query('delete from clinic_hours where clinic_id = any($1)', [
      [firstClinic, secondClinic],
    ]);
    for (const [clinicId, weekday, opens, closes] of [
      [firstClinic, 1, '08:10', '18:00'],
      [firstClinic, 3, '09:00', '13:00'],
      [secondClinic, 2, '07:00', '15:00'],
    ] as const) {
      await insertRow(admin, 'clinic_hours', {
        id: newId(),
        clinic_id: clinicId,
        weekday,
        opens,
        closes,
      });
    }
    const open = { firstClinic: ['monday', 'wednesday'], secondClinic: ['tuesday'] };
    for (const [chosen, days] of [
      [firstClinic, open.firstClinic],
      [secondClinic, open.secondClinic],
    ] as const) {
      request.clinic = chosen;
      const page = await SettingsPage();
      const forms = elementsOf<ComponentProps<typeof OpeningHoursForm>>(page, OpeningHoursForm);
      expect(forms.map((form) => form.key)).toEqual([chosen]);
      const week = forms[0]?.props.week ?? [];
      expect(week.map((day) => day.key)).toEqual([
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ]);
      expect(week.filter((day) => day.open).map((day) => day.key)).toEqual(days);
    }
    request.clinic = firstClinic;
    const page = await SettingsPage();
    const week = elementsOf<ComponentProps<typeof OpeningHoursForm>>(page, OpeningHoursForm)[0]
      ?.props.week;
    expect(week?.[0]).toEqual({
      weekday: 1,
      key: 'monday',
      open: true,
      opens: '08:10',
      closes: '18:00',
    });
    expect(week?.[1]).toEqual({ weekday: 2, key: 'tuesday', open: false, opens: '', closes: '' });
    const details = elementsOf<ComponentProps<typeof ClinicDetailsForm>>(page, ClinicDetailsForm);
    expect(details[0]?.props.values).toMatchObject({ phone: '+389 70 001 402', country: 'MK' });
  });
});
