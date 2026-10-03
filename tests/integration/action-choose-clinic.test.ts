import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { chooseClinic } from '@/app/(auth)/choose-clinic/actions';
import { refuse, userAction } from '@/app/_lib/actions';
import { closeDb } from '@/db/client';
import { logger } from '@/lib/logger';
import { clinicsForUser, createStaffUser } from '@/modules/auth';
import {
  insertClinic,
  insertMembership,
  migratorPool,
  redirectOf,
  signInCookie,
  testEmail,
} from './fixtures';

// The clinic picker's action, now made by userAction (E00-T03, D-071): a signed-in person with no
// clinic yet. Real sessions; next/headers is replaced, as there is no running Next.js. Values are
// synthetic.

const MARKER = 'MARKER-58ea';
const PASSWORD = 'MARKER-pw-2d90-correct';

// What the request carries, and every cookie the action sets.
const request = vi.hoisted(() => ({
  cookie: '',
  set: [] as { name: string; value: string; options: unknown }[],
}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: (name: string, value: string, options: unknown) => {
        request.set.push({ name, value, options });
      },
    }),
}));

// clinicsForUser as it is, watched: the lookup must not happen for a malformed id.
vi.mock('@/modules/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/auth')>();
  return { ...actual, clinicsForUser: vi.fn(actual.clinicsForUser) };
});

const admin = migratorPool();
let clinicA: string; // active membership
let clinicB: string; // disabled membership
let clinicC: string; // no membership
let userId: string;
let cookie: string;

beforeAll(async () => {
  [clinicA, clinicB, clinicC] = await Promise.all([
    insertClinic(admin),
    insertClinic(admin),
    insertClinic(admin),
  ]);
  const email = testEmail();
  ({ id: userId } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD }));
  await insertMembership(admin, { clinicId: clinicA, userId, role: 'dentist' });
  await insertMembership(admin, { clinicId: clinicB, userId, role: 'dentist', status: 'disabled' });
  cookie = await signInCookie(email, PASSWORD, '10.31.0.1');
});

beforeEach(() => {
  request.cookie = cookie;
  request.set = [];
  vi.mocked(clinicsForUser).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** The picker's form as the browser posts it. */
function pickerForm(clinicId: string | undefined): FormData {
  const form = new FormData();
  if (clinicId !== undefined) form.append('clinicId', clinicId);
  return form;
}

describe('chooseClinic, through userAction', () => {
  it('refuses a clinic id that is not a UUID before any lookup, setting no cookie', async () => {
    for (const [sent, code] of [
      [`${MARKER}-not-a-uuid`, 'invalid_format'],
      [undefined, 'invalid_type'],
    ] as const) {
      const result = await chooseClinic(pickerForm(sent));

      expect(result).toEqual({
        ok: false,
        error: { code: 'invalid_input', issues: [{ path: ['clinicId'], code }] },
      });
    }
    expect(vi.mocked(clinicsForUser)).not.toHaveBeenCalled();
    expect(request.set).toEqual([]);
  });

  it('sends a clinic without an active membership back to the picker, with no cookie', async () => {
    for (const clinicId of [clinicB, clinicC]) {
      expect(await redirectOf(chooseClinic(pickerForm(clinicId)))).toBe('/choose-clinic');
    }
    expect(vi.mocked(clinicsForUser)).toHaveBeenCalledWith(userId);
    expect(request.set).toEqual([]);
  });

  it("sets the cookie for the person's own clinic and goes to the app", async () => {
    const logged = vi.spyOn(logger, 'error');

    expect(await redirectOf(chooseClinic(pickerForm(clinicA)))).toBe('/');

    expect(request.set).toEqual([
      {
        name: 'chairside.clinic',
        value: clinicA,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false, // http in tests; true once BETTER_AUTH_URL is https
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
        },
      },
    ]);
    expect(logged, 'a redirect is not a failure').not.toHaveBeenCalled();
  });

  it('takes a plain value from a component too', async () => {
    expect(await redirectOf(chooseClinic({ clinicId: clinicA }))).toBe('/');
    expect(request.set.map((set) => set.value)).toEqual([clinicA]);
  });

  it('sends a request without a session to the login page, looking nothing up', async () => {
    request.cookie = '';
    expect(await redirectOf(chooseClinic(pickerForm(clinicA)))).toBe('/login');
    expect(vi.mocked(clinicsForUser)).not.toHaveBeenCalled();
    expect(request.set).toEqual([]);
  });
});

describe('userAction', () => {
  const probe = userAction(
    { input: z.object({ n: z.number().int() }) },
    async ({ input, user }) => {
      if (input.n === 0) return refuse('not_found');
      if (input.n < 0) throw new Error('the probe failed');
      return { userId: user.id, n: input.n };
    },
  );

  it("answers the handler's result, its refusal, or internal for what it throws", async () => {
    const logged = vi.spyOn(logger, 'error');

    expect(await probe({ n: 2 })).toEqual({ ok: true, value: { userId, n: 2 } });
    expect(await probe({ n: 0 })).toEqual({ ok: false, error: { code: 'not_found' } });
    expect(await probe({ n: -1 })).toEqual({ ok: false, error: { code: 'internal' } });

    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ userId, wrapper: 'userAction' }),
      expect.any(String),
    );
  });

  it('refuses what does not fit the schema without repeating it', async () => {
    const result = await probe({ n: MARKER } as never);
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid_input', issues: [{ path: ['n'], code: 'invalid_type' }] },
    });
  });
});
