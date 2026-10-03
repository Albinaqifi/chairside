import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { createLogger } from '@/lib/logger';
import { createStaffUser, getAuth, SESSION_IDLE_SECONDS, SIGN_IN_RATE_LIMIT } from '@/modules/auth';
import { migratorPool, testEmail } from './fixtures';

// Login through the auth library's own HTTP handler, as the browser uses it (src/app/api/auth).
// Every value here is synthetic; the password is a marker: finding it in a log line means a leak.

const ORIGIN = 'http://localhost:3000'; // BETTER_AUTH_URL in vitest.config.ts
const PASSWORD = 'MARKER-pw-9c2e-correct';
const WRONG_PASSWORD = 'MARKER-pw-9c2e-wrong';

const admin = migratorPool();
let email: string;
let userId: string;

let nextAddress = 1;
/** A client address no other test has used, so rate-limit counters never cross tests. */
const freshAddress = () => `203.0.113.${nextAddress++}`;

beforeAll(async () => {
  email = testEmail();
  ({ id: userId } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD }));
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

interface AuthRequest {
  body?: unknown;
  cookie?: string;
  address?: string;
}

/** Sends a request to the auth library, as the browser would (a POST when there is a body). */
function authRequest(path: string, { body, cookie, address }: AuthRequest = {}): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, 'x-forwarded-for': address ?? freshAddress() });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const signIn = (asEmail: string, password: string, address?: string) =>
  authRequest('/sign-in/email', { body: { email: asEmail, password }, address });

/** The cookies a response sets, as the browser would send them back. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ');
}

/** The session token inside the signed session cookie (`token.signature`, URL-encoded). */
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

describe('signing in and out', () => {
  it('a created user signs in, has a session, and signing out ends it', async () => {
    const response = await signIn(email, PASSWORD);
    expect(response.status).toBe(200);
    const cookie = cookiesOf(response);
    expect(cookie).toContain('chairside.session_token=');

    const session = await authRequest('/get-session', { cookie });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user: { id: string }; session: { userId: string } };
    expect(body.user.id).toBe(userId);
    expect(body.session.userId).toBe(userId);

    // The session ends after 30 minutes (security-privacy.md, section 2).
    const seconds = await sessionSeconds(sessionTokenOf(response));
    expect(seconds).toBeGreaterThan(SESSION_IDLE_SECONDS - 60);
    expect(seconds).toBeLessThanOrEqual(SESSION_IDLE_SECONDS);

    const signOut = await authRequest('/sign-out', { body: {}, cookie });
    expect(signOut.status).toBe(200);
    expect(await (await authRequest('/get-session', { cookie })).json()).toBeNull();
    const { rows } = await admin.query('select 1 from sessions where token = $1', [
      sessionTokenOf(response),
    ]);
    expect(rows).toEqual([]);
  });

  it('refuses a wrong password and an unknown email with the same answer', async () => {
    const wrongPassword = await signIn(email, WRONG_PASSWORD);
    const unknownEmail = await signIn(testEmail(), WRONG_PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const bodies = [await wrongPassword.json(), await unknownEmail.json()] as { message: string }[];
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]!.message).toMatch(/invalid email or password/i);
    expect(wrongPassword.headers.getSetCookie()).toEqual([]);
  });

  it('matches the email without regard to case', async () => {
    expect((await signIn(email.toUpperCase(), PASSWORD)).status).toBe(200);
  });

  it('has no self sign-up', async () => {
    const nobody = testEmail();
    const response = await authRequest('/sign-up/email', {
      body: { email: nobody, password: PASSWORD, name: 'Nobody' },
    });
    expect(response.ok).toBe(false);
    const { rows } = await admin.query('select 1 from users where email = $1', [nobody]);
    expect(rows).toEqual([]);
  });

  it('refuses to create a user with a password too short to sign in with', async () => {
    await expect(
      createStaffUser({ email: testEmail(), name: 'Short', password: 'short' }),
    ).rejects.toThrow(/password/);
  });
});

describe('a session without requests', () => {
  it('has ended after 30 minutes', async () => {
    const response = await signIn(email, PASSWORD);
    const token = sessionTokenOf(response);
    await admin.query(
      `update sessions set expires_at = now() - interval '1 second' where token = $1`,
      [token],
    );

    const session = await authRequest('/get-session', { cookie: cookiesOf(response) });
    expect(await session.json()).toBeNull();
  });

  it('is moved forward while it is being used', async () => {
    const response = await signIn(email, PASSWORD);
    const token = sessionTokenOf(response);
    // As if the last request was 20 minutes ago: 10 minutes left.
    await admin.query(
      `update sessions set expires_at = now() + interval '10 minutes' where token = $1`,
      [token],
    );

    const session = await authRequest('/get-session', { cookie: cookiesOf(response) });
    expect(await session.json()).not.toBeNull();
    expect(await sessionSeconds(token)).toBeGreaterThan(SESSION_IDLE_SECONDS - 60);
  });
});

describe('repeated failed logins', () => {
  it('are blocked for the client address after the limit; the counter is in the database', async () => {
    const address = freshAddress();
    for (let attempt = 0; attempt < SIGN_IN_RATE_LIMIT.max; attempt++) {
      expect((await signIn(email, WRONG_PASSWORD, address)).status).toBe(401);
    }

    // The right password no longer helps from this address.
    const blocked = await signIn(email, PASSWORD, address);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('x-retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.getSetCookie()).toEqual([]);

    // Another address is not blocked: the limit is per client address, not per account.
    expect((await signIn(email, PASSWORD, freshAddress())).status).toBe(200);

    // Shared by every web instance and kept across restarts.
    const { rows } = await admin.query<{ count: number }>(
      'select count from rate_limits where key = $1',
      [`${address}|/sign-in/email`],
    );
    expect(rows[0]?.count).toBe(SIGN_IN_RATE_LIMIT.max);
  });
});

describe('log lines around login', () => {
  it('carry neither the password, nor the session token, nor the email', async () => {
    const response = await signIn(email, PASSWORD);
    const token = sessionTokenOf(response);
    const { rows: sessionRows } = await admin.query('select * from sessions where token = $1', [
      token,
    ]);
    expect(sessionRows).toHaveLength(1);

    const lines: string[] = [];
    const logger = createLogger({ write: (line: string) => void lines.push(line) });
    logger.info(
      {
        request: { headers: { cookie: cookiesOf(response) }, body: { email, password: PASSWORD } },
      },
      'sign-in request',
    );
    logger.info(
      {
        response: {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          setCookie: response.headers.getSetCookie(),
        },
      },
      'sign-in response',
    );
    logger.info({ session: sessionRows[0], userId }, 'session row');
    const output = lines.join('');

    expect(lines).toHaveLength(3);
    expect(output).toContain(userId); // ids stay: the lines are still useful
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(token);
    expect(output).not.toContain(email);
  });
});
