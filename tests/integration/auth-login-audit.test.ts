import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { createStaffUser, getAuth } from '@/modules/auth';
import {
  captureOutput,
  insertClinic,
  insertMembership,
  migratorPool,
  ORIGIN,
  testEmail,
  withoutGrant,
} from './fixtures';

// E00-T08: every sign-in writes `user.logged_in` in each clinic where the person has an active
// membership (D-064, point 4), through the auth library's own handler as the browser uses it. When
// a row cannot be written, the sign-in fails (D-071). Every value is synthetic; a MARKER in a row
// or in the output means a leak.

const PASSWORD = 'MARKER-pw-6d1f-correct';
const SESSION_COOKIE = 'chairside.session_token';

const admin = migratorPool();

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.33.0.${nextAddress++}`;

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

async function staffUser(): Promise<{ id: string; email: string }> {
  const email = testEmail();
  const { id } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD });
  return { id, email };
}

interface SignIn {
  response: Response;
  address: string;
  userAgent: string;
}

/** A sign-in as the browser sends it, from an address and user agent no other sign-in uses. */
async function signIn(email: string): Promise<SignIn> {
  const address = freshAddress();
  const userAgent = `MARKER-ua-${address}`;
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': address,
        'user-agent': userAgent,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  return { response, address, userAgent };
}

/** The session token inside the signed session cookie (`token.signature`, URL-encoded). */
function sessionTokenOf(response: Response): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  expect(cookie, 'a session cookie').toBeDefined();
  return decodeURIComponent(cookie!.split('=')[1]!.split(';')[0]!).split('.')[0]!;
}

async function sessionStart(token: string): Promise<Date> {
  const { rows } = await admin.query<{ created_at: Date }>(
    'select created_at from sessions where token = $1',
    [token],
  );
  expect(rows, 'one session row').toHaveLength(1);
  return rows[0]!.created_at;
}

interface LoginRow {
  clinic_id: string;
  at: Date;
  actor_type: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: unknown;
  /** The whole row as text, to look for values that must not be in it. */
  text: string;
}

/** The person's login rows in every clinic, as the migrator sees them (no Row-Level Security). */
async function loginRows(userId: string): Promise<LoginRow[]> {
  const { rows } = await admin.query<LoginRow>(
    `select clinic_id, at, actor_type, actor_id, action, entity_type, entity_id, metadata,
            row_to_json(a)::text as text
       from audit_log a
      where action = 'user.logged_in' and actor_id = $1
      order by at, clinic_id`,
    [userId],
  );
  return rows;
}

const loginRow = (clinicId: string, userId: string, at: Date) => ({
  clinic_id: clinicId,
  at,
  actor_type: 'user',
  actor_id: userId,
  action: 'user.logged_in',
  entity_type: 'user',
  entity_id: userId,
  metadata: {},
  text: expect.any(String) as unknown,
});

describe('a sign-in', () => {
  it('writes one row in each clinic with an active membership, at the session start, and none in a disabled one', async () => {
    const [clinicA, clinicB, disabled] = await Promise.all([
      insertClinic(admin),
      insertClinic(admin),
      insertClinic(admin),
    ]);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: clinicA, userId: person.id });
    await insertMembership(admin, { clinicId: clinicB, userId: person.id, role: 'dentist' });
    await insertMembership(admin, { clinicId: disabled, userId: person.id, status: 'disabled' });

    const { response, address, userAgent } = await signIn(person.email);

    expect(response.status).toBe(200);
    const token = sessionTokenOf(response);
    const start = await sessionStart(token);
    const rows = await loginRows(person.id);
    expect(rows).toEqual(
      [clinicA, clinicB].sort().map((clinicId) => loginRow(clinicId, person.id, start)),
    );
    for (const row of rows) {
      for (const value of [address, userAgent, person.email, token]) {
        expect(row.text).not.toContain(value);
      }
    }
  });

  it('writes its own rows each time, at the start of its own session', async () => {
    const clinic = await insertClinic(admin);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: clinic, userId: person.id });

    const first = await sessionStart(sessionTokenOf((await signIn(person.email)).response));
    const second = await sessionStart(sessionTokenOf((await signIn(person.email)).response));

    expect(second.getTime()).toBeGreaterThan(first.getTime());
    expect(await loginRows(person.id)).toEqual([
      loginRow(clinic, person.id, first),
      loginRow(clinic, person.id, second),
    ]);
  });

  it('writes no row for a person without an active membership', async () => {
    const clinic = await insertClinic(admin);
    const disabledOnly = await staffUser();
    await insertMembership(admin, {
      clinicId: clinic,
      userId: disabledOnly.id,
      status: 'disabled',
    });
    const withoutAny = await staffUser();

    for (const person of [disabledOnly, withoutAny]) {
      expect((await signIn(person.email)).response.status, 'signed in').toBe(200);
      expect(await loginRows(person.id)).toEqual([]);
    }
  });
});

describe('a sign-in whose login row cannot be written', () => {
  /** The session the library stored before the login rows, which never reached the browser. */
  async function storedSession(userId: string): Promise<{ token: string; created_at: Date }> {
    const { rows } = await admin.query<{ token: string; created_at: Date }>(
      'select token, created_at from sessions where user_id = $1',
      [userId],
    );
    expect(rows, 'the session row the library stored first').toHaveLength(1);
    return rows[0]!;
  }

  it('answers an error, sets no cookie and prints no token, email or query value', async () => {
    const clinic = await insertClinic(admin);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: clinic, userId: person.id });

    const { output, result } = await captureOutput(() =>
      withoutGrant(admin, 'insert', 'audit_log', () => signIn(person.email)),
    );

    expect(result?.response.status).toBe(500);
    expect(result?.response.headers.getSetCookie(), 'no cookie at all').toEqual([]);
    const session = await storedSession(person.id);
    expect(output).toContain('login audit: the login rows could not be written');
    expect(output, 'the insert really failed').toContain('Failed query');
    // The failed insert was sent the session's start as its `at`: no value of it is printed.
    expect(output).not.toContain('params');
    expect(output).not.toContain(session.created_at.toISOString());
    for (const value of [session.token, person.email, result!.address, result!.userAgent]) {
      expect(output).not.toContain(value);
    }
    expect(await loginRows(person.id)).toEqual([]);
  });

  it('also fails when the clinics cannot be listed, with no cookie and no token printed', async () => {
    const clinic = await insertClinic(admin);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: clinic, userId: person.id });

    const { output, result } = await captureOutput(() =>
      withoutGrant(admin, 'execute', 'function clinics_for_user(uuid)', () => signIn(person.email)),
    );

    expect(result?.response.status).toBe(500);
    expect(result?.response.headers.getSetCookie(), 'no cookie at all').toEqual([]);
    const session = await storedSession(person.id);
    expect(output).toContain('login audit: the login rows could not be written');
    for (const value of [session.token, person.email, result!.address, result!.userAgent]) {
      expect(output).not.toContain(value);
    }
    expect(await loginRows(person.id)).toEqual([]);
  });
});
