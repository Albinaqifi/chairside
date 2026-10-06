import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Sidebar } from '@/app/(staff)/sidebar';
import { staffAction } from '@/app/_lib/actions';
import { currentStaff } from '@/app/_lib/auth';
import { closeDb } from '@/db/client';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { clinicsForUser, createStaffUser } from '@/modules/auth';
import {
  appPool,
  insertClinic,
  insertMembership,
  migratorPool,
  redirectOf,
  signInCookie,
  testEmail,
} from './fixtures';
import { insertProvider } from './scheduling-fixtures';

// E01-T01a, acceptance 5: a membership linked to a provider gives the person that provider's kind,
// in the sidebar and in the action wrapper's permission check (D-091). The people sign in through
// the auth library's handler, their memberships and providers are rows in the database, and the
// kind reaches the page through clinics_for_user() and currentStaff(), as in the app. Only Next.js's
// request and router functions and next-intl are replaced, as there is no running Next.js; each
// text is its key. Every value is synthetic.

const PASSWORD = 'MARKER-pw-8b3d-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

interface Person {
  id: string;
  cookie: string;
}

const admin = migratorPool();
const appWithoutTenant = appPool();
let clinicA: string;
let clinicB: string;
let clinicC: string;
let clinicD: string;
/** Owners in clinic A: linked to a dentist column, to a hygienist column, and to none. */
const owner = {} as Record<'ofDentist' | 'ofHygienist' | 'unlinked', Person>;
/** Owner in A linked to a dentist, owner in B linked to none, dentist in C linked to a hygienist,
 * owner in D linked to a dentist but disabled. */
let everywhere: Person;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.38.0.${nextAddress++}`;

async function person(
  memberships: { clinicId: string; role: string; providerId?: string; status?: string }[],
): Promise<Person> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Owner', password: PASSWORD });
  for (const membership of memberships)
    await insertMembership(admin, { ...membership, userId: id });
  return { id, cookie: await signInCookie(email, PASSWORD, freshAddress()) };
}

beforeAll(async () => {
  [clinicA, clinicB, clinicC, clinicD] = [
    await insertClinic(admin),
    await insertClinic(admin),
    await insertClinic(admin),
    await insertClinic(admin),
  ];
  const dentistA = await insertProvider(admin, clinicA, 'dentist');
  const hygienistA = await insertProvider(admin, clinicA, 'hygienist');
  const dentistB = await insertProvider(admin, clinicB, 'dentist');
  const hygienistC = await insertProvider(admin, clinicC, 'hygienist');
  const dentistD = await insertProvider(admin, clinicD, 'dentist');

  owner.ofDentist = await person([{ clinicId: clinicA, role: 'owner', providerId: dentistA }]);
  owner.ofHygienist = await person([{ clinicId: clinicA, role: 'owner', providerId: hygienistA }]);
  owner.unlinked = await person([{ clinicId: clinicA, role: 'owner' }]);
  everywhere = await person([
    { clinicId: clinicA, role: 'owner', providerId: dentistA },
    { clinicId: clinicB, role: 'owner' },
    { clinicId: clinicC, role: 'dentist', providerId: hygienistC },
    { clinicId: clinicD, role: 'owner', providerId: dentistD, status: 'disabled' },
  ]);
  // A colleague in B linked to B's dentist: their link is theirs, not everyone's in B.
  await person([{ clinicId: clinicB, role: 'front_desk', providerId: dentistB }]);
});

afterAll(async () => {
  await closeDb();
  await appWithoutTenant.end();
  await admin.end();
});

/** The next request comes from this person, with this clinic picked. */
function requestFrom(who: Person, picked?: string): void {
  request.cookie = who.cookie;
  request.clinic = picked;
}

/** Where the sidebar's links go, as the staff layout renders it for this request's person. */
async function sidebarLinks(): Promise<string[]> {
  // The staff layout: currentStaff(), then the sidebar for that staff member.
  const html = renderToString(await Sidebar({ staff: await currentStaff() }));
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href = '']) => href);
}

/** Actions made for the tests: they need a permission and change nothing but their audit row. */
const visitInput = z.object({ visitId: z.uuid() });
const visitAudit = {
  action: 'test.visit_recorded',
  entityType: 'test_visit',
  entityId: ({ input }: { input: z.output<typeof visitInput> }) => input.visitId,
};
const recordVisit = staffAction(
  { permission: 'visit.record', input: visitInput, audit: visitAudit },
  async ({ input }) => input.visitId,
);
const approveAftercare = staffAction(
  { permission: 'aftercare.approve', input: visitInput, audit: visitAudit },
  async ({ input }) => input.visitId,
);

const OWNER_LINKS = ['/', '/calendar', '/patients', '/automations', '/import', '/settings'];
const OWNER_LINKS_IN_THE_CHAIR = [
  '/',
  '/calendar',
  '/visit',
  '/patients',
  '/automations',
  '/import',
  '/settings',
];
const forbidden = { ok: false, error: { code: 'forbidden' } };

describe('clinics_for_user() with linked memberships', () => {
  it("returns only that user's active memberships, each with its own provider's kind or none", async () => {
    const { rows } = await appWithoutTenant.query<{
      clinic_id: string;
      provider_kind: string | null;
    }>('select clinic_id, provider_kind from clinics_for_user($1)', [everywhere.id]);
    const byClinic = (x: { clinic_id: string }, y: { clinic_id: string }) =>
      x.clinic_id.localeCompare(y.clinic_id);
    expect(rows.sort(byClinic)).toEqual(
      [
        { clinic_id: clinicA, provider_kind: 'dentist' },
        { clinic_id: clinicB, provider_kind: null },
        { clinic_id: clinicC, provider_kind: 'hygienist' },
      ].sort(byClinic),
    );
  });

  it('returns these six columns and nothing else', async () => {
    const { fields } = await appWithoutTenant.query('select * from clinics_for_user($1)', [
      everywhere.id,
    ]);
    expect(fields.map((field) => field.name)).toEqual([
      'membership_id',
      'clinic_id',
      'clinic_name',
      'role',
      'extra_permissions',
      'provider_kind',
    ]);
  });

  it('gives clinicsForUser() each choice with its provider kind', async () => {
    const choices = await clinicsForUser(everywhere.id);
    expect(
      Object.fromEntries(
        choices.map((choice) => [choice.clinicId, [choice.role, choice.providerKind]]),
      ),
    ).toEqual({
      [clinicA]: ['owner', 'dentist'],
      [clinicB]: ['owner', null],
      [clinicC]: ['dentist', 'hygienist'],
    });
  });
});

describe.each([
  {
    who: 'an owner linked to a dentist column',
    key: 'ofDentist',
    kind: 'dentist',
    inTheChair: true,
    approves: true,
  },
  {
    who: 'an owner linked to a hygienist column',
    key: 'ofHygienist',
    kind: 'hygienist',
    inTheChair: true,
    approves: false,
  },
  {
    who: 'an owner linked to no provider',
    key: 'unlinked',
    kind: null,
    inTheChair: false,
    approves: false,
  },
] as const)('$who', ({ key, kind, inTheChair, approves }) => {
  it(`is staff with the provider kind ${String(kind)}`, async () => {
    requestFrom(owner[key]);
    expect((await currentStaff()).clinic.providerKind).toBe(kind);
  });

  it(`${inTheChair ? 'sees' : 'does not see'} In the chair in the sidebar`, async () => {
    requestFrom(owner[key]);
    expect(await sidebarLinks()).toEqual(inTheChair ? OWNER_LINKS_IN_THE_CHAIR : OWNER_LINKS);
  });

  it(`${inTheChair ? 'may' : 'may not'} run a visit.record action`, async () => {
    requestFrom(owner[key]);
    const visitId = newId();
    expect(await recordVisit(clinicA, { visitId })).toEqual(
      inTheChair ? { ok: true, value: visitId } : forbidden,
    );
  });

  it(`${approves ? 'may' : 'may not'} run an aftercare.approve action (D-051)`, async () => {
    requestFrom(owner[key]);
    const visitId = newId();
    expect(await approveAftercare(clinicA, { visitId })).toEqual(
      approves ? { ok: true, value: visitId } : forbidden,
    );
  });
});

describe('one person, a link in one clinic and none in another', () => {
  it("acts with each clinic's own link: In the chair and visit.record in A, neither in B", async () => {
    requestFrom(everywhere, clinicA);
    expect(await sidebarLinks()).toEqual([...OWNER_LINKS_IN_THE_CHAIR, '/choose-clinic']);
    expect((await recordVisit(clinicA, { visitId: newId() })).ok).toBe(true);

    requestFrom(everywhere, clinicB);
    expect(await sidebarLinks()).toEqual([...OWNER_LINKS, '/choose-clinic']);
    expect(await recordVisit(clinicB, { visitId: newId() })).toEqual(forbidden);
  });

  it('a disabled membership gives nothing, whatever it is linked to', async () => {
    requestFrom(everywhere, clinicD);
    // Not one of the person's clinics: the clinic picker, never clinic D.
    expect(await redirectOf(currentStaff())).toBe('/choose-clinic');
    expect(await redirectOf(recordVisit(clinicD, { visitId: newId() }))).toBe('/choose-clinic');
  });
});

describe('the kind is read again on every request (E01-T01a, tester)', () => {
  it("a provider's kind changed, or the link removed, counts from the next request, without a new sign-in", async () => {
    const clinic = await insertClinic(admin);
    const provider = await insertProvider(admin, clinic, 'dentist');
    const linked = await person([{ clinicId: clinic, role: 'owner', providerId: provider }]);
    requestFrom(linked);
    expect((await approveAftercare(clinic, { visitId: newId() })).ok).toBe(true);

    await admin.query(`update providers set kind = 'hygienist' where id = $1`, [provider]);
    expect(await approveAftercare(clinic, { visitId: newId() })).toEqual(forbidden);
    expect((await recordVisit(clinic, { visitId: newId() })).ok).toBe(true);

    await admin.query('update memberships set provider_id = null where user_id = $1', [linked.id]);
    expect(await recordVisit(clinic, { visitId: newId() })).toEqual(forbidden);
    expect(await sidebarLinks()).toEqual(OWNER_LINKS);
  });
});

describe('clinics_for_user() keeps its guards (E01-T01a, tester)', () => {
  // Migration 0002 drops the function and creates it again, so both guards were written anew.
  it('runs as its owner with a fixed search_path', async () => {
    const { rows } = await admin.query(
      `select prosecdef as definer, proconfig as config from pg_proc
        where oid = 'public.clinics_for_user(uuid)'::regprocedure`,
    );
    expect(rows).toEqual([{ definer: true, config: ['search_path=pg_catalog, public'] }]);
  });

  it('only the app role and its owner may call it, not PUBLIC', async () => {
    const { rows } = await admin.query<{ grantee: string }>(
      `select coalesce(r.rolname, 'PUBLIC') as grantee
         from pg_proc p
         cross join lateral aclexplode(p.proacl) a
         left join pg_roles r on r.oid = a.grantee
        where p.oid = 'public.clinics_for_user(uuid)'::regprocedure
          and a.privilege_type = 'EXECUTE'
        order by 1`,
    );
    expect(rows.map((row) => row.grantee)).toEqual(['chairside_app', 'chairside_migrator']);
  });
});
