import { inspect } from 'node:util';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { createStaffUser, getAuth, SESSION_IDLE_SECONDS, SIGN_IN_RATE_LIMIT } from '@/modules/auth';
import {
  expectPgError,
  insertClinic,
  insertMembership,
  migratorPool,
  PG,
  testEmail,
} from './fixtures';

// Tester, E00-T02: ways around the login rules, through the auth library's own HTTP handler as
// the browser uses it. Every value is synthetic; MARKER values must never reach a log line.
// The library skips its origin check when NODE_ENV is test, so cross-origin requests are checked
// against the running app (handoff note), not here.

const ORIGIN = 'http://localhost:3000'; // BETTER_AUTH_URL in vitest.config.ts
const PASSWORD = 'MARKER-pw-7f41-correct';

const admin = migratorPool();
let email: string;

let nextAddress = 1;
/** A client address no other test has used, so rate-limit counters never cross tests. */
const freshAddress = () => `192.0.2.${nextAddress++}`;

beforeAll(async () => {
  email = testEmail();
  await createStaffUser({ email, name: 'Test Staff', password: PASSWORD });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

interface AuthRequest {
  body?: unknown;
  cookie?: string;
  address?: string;
  userAgent?: string;
}

function authRequest(
  path: string,
  { body, cookie, address, userAgent }: AuthRequest = {},
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, 'x-forwarded-for': address ?? freshAddress() });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  if (userAgent) headers.set('user-agent', userAgent);
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ');

function sessionTokenOf(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith('chairside.session_token='));
  expect(cookie, 'a session cookie').toBeDefined();
  return decodeURIComponent(cookie!.split('=')[1]!.split(';')[0]!).split('.')[0]!;
}

async function sessionSeconds(token: string): Promise<number> {
  const { rows } = await admin.query<{ seconds: string }>(
    'select extract(epoch from (expires_at - now())) as seconds from sessions where token = $1',
    [token],
  );
  expect(rows, 'one session row').toHaveLength(1);
  return Number(rows[0]!.seconds);
}

/**
 * Everything written to the console, stdout and stderr while `fn` runs, as text. An error that
 * escapes counts as output too: whatever catches it prints it (Next.js does, values included).
 */
async function captureOutput(fn: () => Promise<unknown>): Promise<string> {
  const written: string[] = [];
  const keep = (...args: unknown[]) => void written.push(args.map((a) => inspect(a)).join(' '));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(keep);
  }
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      written.push(String(chunk));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write);
  }
  try {
    await fn();
  } catch (error) {
    written.push(inspect(error));
  }
  return written.join('\n');
}

describe('a session without requests, whatever the client asks for', () => {
  it('ends after 30 minutes even when sign-in says rememberMe: false', async () => {
    // The library gives a "do not remember me" session a fixed 24 hours and never refreshes it.
    const response = await authRequest('/sign-in/email', {
      body: { email, password: PASSWORD, rememberMe: false },
    });
    // Refused, or a session that ends within the 30 minutes: both keep the rule.
    if (response.status === 200) {
      expect(await sessionSeconds(sessionTokenOf(response))).toBeLessThanOrEqual(
        SESSION_IDLE_SECONDS,
      );
    } else {
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('guessing a password from a signed-in session', () => {
  it('is limited like sign-in: /verify-password', { timeout: 60_000 }, async () => {
    const signIn = await authRequest('/sign-in/email', { body: { email, password: PASSWORD } });
    expect(signIn.status).toBe(200);
    const cookie = cookiesOf(signIn);
    const address = freshAddress();

    let answered = 0; // wrong guesses the library checked and answered (not blocked, not absent)
    for (let attempt = 0; attempt < SIGN_IN_RATE_LIMIT.max * 3; attempt++) {
      const response = await authRequest('/verify-password', {
        body: { password: `MARKER-guess-${attempt}` },
        cookie,
        address,
      });
      if (response.status !== 429 && response.status !== 404) answered++;
    }
    expect(answered).toBeLessThanOrEqual(SIGN_IN_RATE_LIMIT.max);
  });
});

describe('a failed query during sign-in', () => {
  // The migrator owns the tables, so it can take a grant away from the app role for one request.
  async function withoutGrant(grant: string, table: string, fn: () => Promise<unknown>) {
    await admin.query(`revoke ${grant} on ${table} from chairside_app`);
    try {
      await fn();
    } finally {
      await admin.query(`grant ${grant} on ${table} to chairside_app`);
    }
  }

  it('writes neither the email nor the new session to any output', async () => {
    const userAgent = 'MARKER-ua-5c0e';
    const address = '192.0.2.250';
    let status: number | undefined;
    const output = await captureOutput(() =>
      withoutGrant('insert', 'sessions', async () => {
        status = (
          await authRequest('/sign-in/email', {
            body: { email, password: PASSWORD },
            address,
            userAgent,
          })
        ).status;
      }),
    );
    expect(status, 'the session could not be written').not.toBe(200);
    expect(output).not.toContain(userAgent);
    expect(output).not.toContain(address); // address and user agent travel with the session token
  });

  it('writes no email that was typed into the form', async () => {
    const typed = `marker-${testEmail()}`;
    const output = await captureOutput(() =>
      withoutGrant('select', 'users', () =>
        authRequest('/sign-in/email', { body: { email: typed, password: 'MARKER-pw-typed' } }),
      ),
    );
    expect(output).not.toContain(typed);
    expect(output).not.toContain('MARKER-pw-typed');
  });
});

describe('memberships through the app role', () => {
  it('can be neither changed nor removed, in the own clinic or another', async () => {
    const [clinicA, clinicB] = await Promise.all([insertClinic(admin), insertClinic(admin)]);
    const user = (
      await createStaffUser({ email: testEmail(), name: 'Test Staff', password: PASSWORD })
    ).id;
    const inA = await insertMembership(admin, {
      clinicId: clinicA,
      userId: user,
      role: 'front_desk',
    });
    await insertMembership(admin, { clinicId: clinicB, userId: user, role: 'front_desk' });

    for (const clinic of [clinicA, clinicB]) {
      await withTenant(clinic, async (tx) => {
        await expectPgError(
          tx.execute(sql`update memberships set role = 'owner' where id = ${inA}`),
          PG.insufficientPrivilege,
        );
      });
      await withTenant(clinic, async (tx) => {
        await expectPgError(
          tx.execute(sql`delete from memberships where id = ${inA}`),
          PG.insufficientPrivilege,
        );
      });
    }
    const { rows } = await admin.query('select role from memberships where id = $1', [inA]);
    expect(rows).toEqual([{ role: 'front_desk' }]);
  });
});
