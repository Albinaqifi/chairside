import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
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
import PatientsPage from '@/app/(staff)/patients/page';
import { PlaceholderPage } from '@/app/(staff)/placeholder-page';
import SettingsPage from '@/app/(staff)/settings/page';
import { Sidebar } from '@/app/(staff)/sidebar';
import VisitPage from '@/app/(staff)/visit/page';
import { closeDb } from '@/db/client';
import { CLINIC_COOKIE } from '@/lib/cookies';
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
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
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

/** Where each page, and the layout around them, sent the person; undefined where it rendered. */
async function whereEachGoes(): Promise<Record<string, string | undefined>> {
  const outcome: Record<string, string | undefined> = {};
  for (const [path, page] of Object.entries(PAGES)) outcome[path] = await redirectOf(page());
  outcome.layout = await redirectOf(StaffLayout({ children: null }));
  return outcome;
}

/** The same answer for every page and the layout. */
const everywhere = (answer: string | undefined) =>
  Object.fromEntries([...Object.keys(PAGES), 'layout'].map((key) => [key, answer]));

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
    expect(await whereEachGoes()).toEqual(everywhere(undefined));
  });

  it('a member of two clinics who chose one: every page and the layout render', async () => {
    request.cookie = await signInCookie(twoClinics.email, PASSWORD, freshAddress());
    request.clinic = secondClinic;
    expect(await whereEachGoes()).toEqual(everywhere(undefined));
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
        expect(await pageClinicsOf(page), path).toEqual([chosen]);
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
