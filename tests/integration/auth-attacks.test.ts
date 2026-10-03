import fs from 'node:fs';
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
  // Our logger (pino) writes to the file descriptors directly, not through process.stdout.
  const writeSync = fs.writeSync;
  vi.spyOn(fs, 'writeSync').mockImplementation(((
    fd: unknown,
    data: unknown,
    ...rest: unknown[]
  ) => {
    if (fd === 1 || fd === 2) written.push(String(data));
    return (writeSync as (...a: unknown[]) => number)(fd, data, ...rest);
  }) as typeof fs.writeSync);
  const writeAsync = fs.write;
  vi.spyOn(fs, 'write').mockImplementation(((fd: unknown, data: unknown, ...rest: unknown[]) => {
    if (fd === 1 || fd === 2) written.push(String(data));
    return (writeAsync as (...a: unknown[]) => void)(fd, data, ...rest);
  }) as typeof fs.write);
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

  it('ends after 30 minutes for every other way of sending rememberMe', async () => {
    // Tester, fix round 1. Only a JSON false is refused; no other body may get the library's
    // 24-hour "do not remember me" session either (sign-in also takes a form).
    const json = 'application/json';
    const credentials = `"email":${JSON.stringify(email)},"password":${JSON.stringify(PASSWORD)}`;
    const bodies: [label: string, body: string, contentType: string][] = [
      ...['"false"', '0', 'null', '""', '[]', '{}', 'true'].map(
        (value): [string, string, string] => [
          `rememberMe: ${value}`,
          `{${credentials},"rememberMe":${value}}`,
          json,
        ],
      ),
      ['false, then true', `{${credentials},"rememberMe":false,"rememberMe":true}`, json],
      ['true, then false', `{${credentials},"rememberMe":true,"rememberMe":false}`, json],
      ['false, inherited', `{${credentials},"__proto__":{"rememberMe":false}}`, json],
      [
        'a form',
        new URLSearchParams({ email, password: PASSWORD, rememberMe: 'false' }).toString(),
        'application/x-www-form-urlencoded',
      ],
    ];

    for (const [label, body, contentType] of bodies) {
      const response = await getAuth().handler(
        new Request(`${ORIGIN}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            origin: ORIGIN,
            'x-forwarded-for': freshAddress(),
            'content-type': contentType,
          },
          body,
        }),
      );
      const cookies = response.headers.getSetCookie();
      expect(
        cookies.filter((c) => c.includes('dont_remember')),
        label,
      ).toEqual([]);
      if (response.status === 200) {
        expect(await sessionSeconds(sessionTokenOf(response)), label).toBeLessThanOrEqual(
          SESSION_IDLE_SECONDS,
        );
        // A "do not remember me" session cookie has no Max-Age; ours always has one.
        const sessionCookie = cookies.find((c) => c.startsWith('chairside.session_token='));
        expect(sessionCookie, label).toMatch(/Max-Age=/i);
      } else {
        expect(response.status, label).toBeGreaterThanOrEqual(400);
        expect(cookies, label).toEqual([]);
      }
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

  // Tester, fix round 1: the limit on the two routes that check a password after sign-in.
  const wrongGuess: Record<string, object> = {
    '/verify-password': { password: 'MARKER-guess-wrong' },
    '/change-password': {
      currentPassword: 'MARKER-guess-wrong',
      newPassword: 'MARKER-pw-new-7e3b',
    },
  };
  const sessionCookie = async () => {
    const response = await authRequest('/sign-in/email', { body: { email, password: PASSWORD } });
    expect(response.status).toBe(200);
    return cookiesOf(response);
  };

  it.each(Object.keys(wrongGuess))(
    '%s: no other spelling of the path and no other session starts a fresh count',
    { timeout: 60_000 },
    async (path) => {
      const body = wrongGuess[path]!;
      const cookie = await sessionCookie();
      const address = freshAddress();
      for (let attempt = 0; attempt < SIGN_IN_RATE_LIMIT.max; attempt++) {
        const response = await authRequest(path, { body, cookie, address });
        expect(response.status, 'a wrong password').toBe(400);
      }

      const spellings = [
        `${path}/`,
        `/${path}`,
        `${path}?again=1`,
        `${path}#again`,
        `/.${path}`,
        `/x/..${path}`,
        `/%2e${path}`,
        path.toUpperCase(),
        path.replace('d', '%64'),
        `${path}%20`,
        `${path};x`,
      ];
      for (const spelling of spellings) {
        const response = await authRequest(spelling, { body, cookie, address });
        expect([404, 429], `${spelling} must not check a password`).toContain(response.status);
      }
      const otherSession = await sessionCookie();
      const response = await authRequest(path, { body, cookie: otherSession, address });
      expect(response.status, 'another session, same address').toBe(429);
    },
  );

  it.each(Object.keys(wrongGuess))(
    '%s: thirty guesses at once still get at most the limit answered',
    async (path) => {
      const cookie = await sessionCookie();
      const address = freshAddress();
      const statuses = await Promise.all(
        Array.from({ length: SIGN_IN_RATE_LIMIT.max * 3 }, () =>
          authRequest(path, { body: wrongGuess[path], cookie, address }).then((r) => r.status),
        ),
      );
      expect(statuses.filter((status) => status === 400)).toHaveLength(SIGN_IN_RATE_LIMIT.max);
      expect(statuses.filter((status) => status !== 400 && status !== 429)).toEqual([]);
    },
  );
});

// The migrator owns the tables, so it can take a grant away from the app role for one request.
async function withoutGrant(grant: string, table: string, fn: () => Promise<unknown>) {
  await admin.query(`revoke ${grant} on ${table} from chairside_app`);
  try {
    await fn();
  } finally {
    await admin.query(`grant ${grant} on ${table} to chairside_app`);
  }
}

describe('a failed query during sign-in', () => {
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

describe('a failed query on the other auth routes', () => {
  // Tester, fix round 1: every query the library makes must fail without printing its values,
  // not only those of sign-in. "Failed query" in the output shows the query really failed.
  let lastOctet = 100;
  /** A client address for one test only; three digits, so no other address is part of it. */
  const markerAddress = () => `198.51.100.${lastOctet++}`;

  async function signedIn(userEmail = email) {
    const address = markerAddress();
    const userAgent = `MARKER-ua-${address}`;
    const response = await authRequest('/sign-in/email', {
      body: { email: userEmail, password: PASSWORD },
      address,
      userAgent,
    });
    expect(response.status).toBe(200);
    return { cookie: cookiesOf(response), token: sessionTokenOf(response), address, userAgent };
  }

  it('reading the session prints no session token', async () => {
    const { cookie, token, address, userAgent } = await signedIn();
    const output = await captureOutput(() =>
      withoutGrant('select', 'sessions', () =>
        authRequest('/get-session', { cookie, address, userAgent }),
      ),
    );
    expect(output).toContain('Failed query');
    expect(output).not.toContain(token);
  });

  it('moving the session forward prints no session token', async () => {
    const { cookie, token, address, userAgent } = await signedIn();
    // Due for its refresh: the expiry is moved forward once a minute has passed since the last move.
    await admin.query(
      `update sessions set expires_at = expires_at - interval '2 minutes' where token = $1`,
      [token],
    );
    const output = await captureOutput(() =>
      withoutGrant('update', 'sessions', () =>
        authRequest('/get-session', { cookie, address, userAgent }),
      ),
    );
    expect(output).toContain('Failed query');
    expect(output).not.toContain(token);
  });

  it('signing out prints no session token', async () => {
    const { cookie, token, address, userAgent } = await signedIn();
    const output = await captureOutput(() =>
      withoutGrant('delete', 'sessions', () =>
        authRequest('/sign-out', { body: {}, cookie, address, userAgent }),
      ),
    );
    expect(output).toContain('Failed query');
    expect(output).not.toContain(token);
  });

  it('counting requests for the rate limit prints no client address', async () => {
    for (const grant of ['select', 'insert', 'update']) {
      const address = markerAddress();
      const signIn = () =>
        authRequest('/sign-in/email', { body: { email, password: PASSWORD }, address });
      // A counter must exist before an update can fail.
      if (grant === 'update') expect((await signIn()).status).toBe(200);
      const output = await captureOutput(() => withoutGrant(grant, 'rate_limits', signIn));
      expect(output, grant).toContain('Failed query');
      expect(output, grant).not.toContain(address);
    }
  });

  it('changing the password prints no password hash', async () => {
    const userEmail = testEmail();
    await createStaffUser({ email: userEmail, name: 'Test Staff', password: PASSWORD });
    const { cookie, address, userAgent } = await signedIn(userEmail);
    const { password } = await getAuth().$context;
    const hash = password.hash;
    const hashes: string[] = [];
    vi.spyOn(password, 'hash').mockImplementation(async (plain) => {
      const hashed = await hash(plain);
      hashes.push(hashed);
      return hashed;
    });

    const output = await captureOutput(() =>
      withoutGrant('update', 'accounts', () =>
        authRequest('/change-password', {
          body: { currentPassword: PASSWORD, newPassword: 'MARKER-pw-new-5d2a' },
          cookie,
          address,
          userAgent,
        }),
      ),
    );
    expect(hashes, 'the new password was hashed').toHaveLength(1);
    expect(output).toContain('Failed query');
    expect(output).not.toContain(hashes[0]);
  });

  it('changing the password and the session prints nothing of the new session', async () => {
    const userEmail = testEmail();
    await createStaffUser({ email: userEmail, name: 'Test Staff', password: PASSWORD });
    const { cookie, address, userAgent } = await signedIn(userEmail);
    const output = await captureOutput(() =>
      withoutGrant('insert', 'sessions', () =>
        authRequest('/change-password', {
          body: {
            currentPassword: PASSWORD,
            newPassword: 'MARKER-pw-new-8b1f',
            revokeOtherSessions: true,
          },
          cookie,
          address,
          userAgent,
        }),
      ),
    );
    expect(output).toContain('Failed query');
    expect(output).not.toContain(userAgent);
    expect(output).not.toContain(address);
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
