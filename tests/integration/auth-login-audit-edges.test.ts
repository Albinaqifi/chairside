import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { isUuid } from '@/lib/ids';
import { createStaffUser, getAuth } from '@/modules/auth';
import {
  captureOutput,
  insertClinic,
  insertMembership,
  migratorPool,
  ORIGIN,
  testEmail,
} from './fixtures';

// Tester, E00-T08: the login rows where the builder's tests do not go. A failure in a later clinic
// only (one transaction per clinic, D-074), two sign-ins at once, and a membership disabled between
// two sign-ins. Every value is synthetic; a MARKER in the output means a leak.

const PASSWORD = 'MARKER-pw-5e2a-correct';
const SESSION_COOKIE = 'chairside.session_token';

const admin = migratorPool();

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.35.0.${nextAddress++}`;

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

async function signIn(email: string): Promise<Response> {
  const address = freshAddress();
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': address,
        'user-agent': `MARKER-ua-${address}`,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
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

/** The person's login rows as (clinic, start) pairs, in a fixed order. */
async function loginRows(userId: string): Promise<{ clinic: string; at: number }[]> {
  const { rows } = await admin.query<{ clinic_id: string; at: Date }>(
    `select clinic_id, at from audit_log
      where action = 'user.logged_in' and actor_id = $1 and entity_id = $1`,
    [userId],
  );
  return sortRows(rows.map((row) => ({ clinic: row.clinic_id, at: row.at.getTime() })));
}

const sortRows = (rows: { clinic: string; at: number }[]) =>
  [...rows].sort((a, b) => a.at - b.at || a.clinic.localeCompare(b.clinic));

/** The person's clinics in the order the login hook visits them (clinics_for_user()). */
async function hookOrder(userId: string): Promise<string[]> {
  const { rows } = await admin.query<{ clinic_id: string }>(
    'select clinic_id from clinics_for_user($1)',
    [userId],
  );
  return rows.map((row) => row.clinic_id);
}

/**
 * Runs `fn` while audit_log refuses every new row of one clinic: a check constraint the migrator
 * (the table's owner) adds and takes away. The insert then fails with a check violation, whose
 * detail ("Failing row contains …") holds every value of the row.
 */
async function whileClinicRefusesRows<T>(clinicId: string, fn: () => Promise<T>): Promise<T> {
  expect(isUuid(clinicId)).toBe(true); // it goes into the statement's text
  await admin.query(
    `alter table audit_log add constraint tester_refuses_clinic
       check (clinic_id <> '${clinicId}'::uuid) not valid`,
  );
  try {
    return await fn();
  } finally {
    await admin.query('alter table audit_log drop constraint tester_refuses_clinic');
  }
}

describe('tester: a login row that fails in a later clinic only', () => {
  it('fails the sign-in with no cookie; the earlier clinic keeps its row (D-074), and nothing personal is printed', async () => {
    const [one, two] = await Promise.all([insertClinic(admin), insertClinic(admin)]);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: one, userId: person.id });
    await insertMembership(admin, { clinicId: two, userId: person.id });
    const order = await hookOrder(person.id);
    expect([...order].sort()).toEqual([one, two].sort());
    const first = order[0]!;
    const second = order[1]!;

    const { output, result } = await captureOutput(() =>
      whileClinicRefusesRows(second, () => signIn(person.email)),
    );

    expect(result?.status).toBe(500);
    expect(result?.headers.getSetCookie(), 'no cookie at all').toEqual([]);
    const body = await result!.text();
    const { rows: stored } = await admin.query<{ token: string; created_at: Date }>(
      'select token, created_at from sessions where user_id = $1',
      [person.id],
    );
    expect(stored, 'the session row stored before the login rows').toHaveLength(1);
    const session = stored[0]!;
    // The first clinic's transaction had committed: its row stays. The second has none.
    expect(await loginRows(person.id)).toEqual([
      { clinic: first, at: session.created_at.getTime() },
    ]);
    // Logged once, naming the clinic that failed, by id.
    expect(output).toContain('login audit: the login rows could not be written');
    expect(output).toContain(second);
    expect(output, 'the constraint really refused the row').toContain('tester_refuses_clinic');
    // The check violation's detail lists the row's values: it must not be printed.
    expect(output).not.toContain('Failing row');
    expect(output).not.toContain('params');
    for (const value of [session.token, person.email, 'MARKER']) {
      expect(output).not.toContain(value);
      expect(body).not.toContain(value);
    }
    for (const id of [person.id, one, two]) expect(body, 'no id in the answer').not.toContain(id);
  });
});

describe('tester: sign-ins that overlap or follow a change', () => {
  it('two sign-ins at once each write their own rows, one per clinic, at their own start', async () => {
    const [one, two] = await Promise.all([insertClinic(admin), insertClinic(admin)]);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: one, userId: person.id });
    await insertMembership(admin, { clinicId: two, userId: person.id, role: 'owner' });

    const responses = await Promise.all([signIn(person.email), signIn(person.email)]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const starts = await Promise.all(responses.map((r) => sessionStart(sessionTokenOf(r))));
    expect(await loginRows(person.id)).toEqual(
      sortRows(
        starts.flatMap((start) => [one, two].map((clinic) => ({ clinic, at: start.getTime() }))),
      ),
    );
  });

  it('a membership disabled between two sign-ins: the second writes no row in that clinic', async () => {
    const [kept, dropped] = await Promise.all([insertClinic(admin), insertClinic(admin)]);
    const person = await staffUser();
    await insertMembership(admin, { clinicId: kept, userId: person.id });
    await insertMembership(admin, { clinicId: dropped, userId: person.id });

    const first = await sessionStart(sessionTokenOf(await signIn(person.email)));
    await admin.query(
      `update memberships set status = 'disabled' where clinic_id = $1 and user_id = $2`,
      [dropped, person.id],
    );
    const second = await sessionStart(sessionTokenOf(await signIn(person.email)));

    expect(await loginRows(person.id)).toEqual(
      sortRows([
        { clinic: kept, at: first.getTime() },
        { clinic: dropped, at: first.getTime() },
        { clinic: kept, at: second.getTime() },
      ]),
    );
  });
});
