import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { settledStaff } from '@/app/_lib/auth';
import { closeDb } from '@/db/client';
import { NO_CLINIC_TIME_ZONE, requestTimeZone } from '@/i18n/request';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { createStaffUser } from '@/modules/auth';
import {
  insertClinic,
  insertMembership,
  migratorPool,
  redirectOf,
  signInCookie,
  testEmail,
} from './fixtures';

// E01-T02a, acceptance 4: the time zone src/i18n/request.ts gives every page. Signed out, and
// before a clinic is chosen (the login page, the clinic picker), a fixed zone, and nobody is sent
// anywhere; in a settled clinic, the clinic's own zone, read through the wrapper in the clinic's
// transaction. The people sign in through the auth library's handler and their memberships are rows
// in the database; only Next.js's request functions and next-intl's wrapper are replaced, as there
// is no running Next.js. Every value is synthetic.

const PASSWORD = 'MARKER-pw-4d7a-correct';

const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === CLINIC_COOKIE && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));
vi.mock('next-intl/server', () => ({ getRequestConfig: (create: unknown) => create }));

const admin = migratorPool();
let inAuckland: string;
let inNewYork: string;
let oneClinic: string;
let twoClinics: string;
let noClinic: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.37.0.${nextAddress++}`;

/** A synthetic member of the given clinics, named with a role word; their email. */
async function member(clinics: string[]): Promise<string> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Front desk', password: PASSWORD });
  for (const clinicId of clinics) await insertMembership(admin, { clinicId, userId: id });
  return email;
}

/** The zone this request gets, and where it sent the person: undefined, nowhere. */
async function zoneAndRedirect(): Promise<{ zone: string; redirect: string | undefined }> {
  let zone = '';
  const redirect = await redirectOf(
    requestTimeZone().then((found) => {
      zone = found;
    }),
  );
  return { zone, redirect };
}

beforeAll(async () => {
  inAuckland = await insertClinic(admin);
  inNewYork = await insertClinic(admin);
  await admin.query(`update clinics set timezone = 'Pacific/Auckland' where id = $1`, [inAuckland]);
  await admin.query(`update clinics set timezone = 'America/New_York' where id = $1`, [inNewYork]);
  oneClinic = await member([inAuckland]);
  twoClinics = await member([inAuckland, inNewYork]);
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

describe('the time zone of every page (src/i18n/request.ts)', () => {
  it('signed out, as on the login page: the fixed zone, nobody sent anywhere', async () => {
    expect(await zoneAndRedirect()).toEqual({ zone: NO_CLINIC_TIME_ZONE, redirect: undefined });
    expect(await settledStaff()).toBeNull();
  });

  it('with a session cookie that names no session: the same', async () => {
    request.cookie = 'chairside.session_token=not-a-session.not-a-signature';
    expect(await zoneAndRedirect()).toEqual({ zone: NO_CLINIC_TIME_ZONE, redirect: undefined });
  });

  it('a member of two clinics who has not chosen one, as on the clinic picker: the same', async () => {
    request.cookie = await signInCookie(twoClinics, PASSWORD, freshAddress());
    expect(await zoneAndRedirect()).toEqual({ zone: NO_CLINIC_TIME_ZONE, redirect: undefined });
  });

  it('a person with no clinic: the same', async () => {
    request.cookie = await signInCookie(noClinic, PASSWORD, freshAddress());
    expect(await zoneAndRedirect()).toEqual({ zone: NO_CLINIC_TIME_ZONE, redirect: undefined });
  });

  it("a member of one clinic: that clinic's zone", async () => {
    request.cookie = await signInCookie(oneClinic, PASSWORD, freshAddress());
    expect(await zoneAndRedirect()).toEqual({ zone: 'Pacific/Auckland', redirect: undefined });
  });

  it.each([
    { which: 'first', zone: 'Pacific/Auckland' },
    { which: 'second', zone: 'America/New_York' },
  ])('a member of two clinics who chose the $which one: its zone', async ({ which, zone }) => {
    request.cookie = await signInCookie(twoClinics, PASSWORD, freshAddress());
    request.clinic = which === 'first' ? inAuckland : inNewYork;
    expect(await zoneAndRedirect()).toEqual({ zone, redirect: undefined });
  });
});
