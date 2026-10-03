import { NextRequest, type NextResponse } from 'next/server';
import { getRedirectUrl } from 'next/experimental/testing/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { currentUser } from '@/app/_lib/auth';
import { closeDb } from '@/db/client';
import { createStaffUser, getAuth, SESSION_IDLE_SECONDS } from '@/modules/auth';
import { proxy } from '@/proxy';
import { migratorPool, testEmail } from './fixtures';

// Reviewer, E00-T02, required change 1: the browser's session cookie must end when the session
// does, 30 minutes after the last request. The library moves the session's end forward at most
// once a minute and sends a renewed cookie with that move; a Server Component cannot set cookies,
// so the request proxy (src/proxy.ts) makes the move and carries the cookie, and pages only read.
// Every value here is synthetic.

const ORIGIN = 'http://localhost:3000'; // BETTER_AUTH_URL in vitest.config.ts
const PASSWORD = 'MARKER-pw-5b8d-correct';
const SESSION_COOKIE = 'chairside.session_token';

// What a staff page sees as its request headers (next/headers outside a running Next.js).
const page = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(page.headers),
  cookies: () => Promise.reject(new Error('cookies() is not used by currentUser()')),
}));

const admin = migratorPool();
let email: string;
let userId: string;

let nextAddress = 1;
/** A client address no other test has used, so rate-limit counters never cross tests. */
const freshAddress = () => `198.51.100.${nextAddress++}`;

beforeAll(async () => {
  email = testEmail();
  ({ id: userId } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD }));
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

interface SignedIn {
  /** The cookies as the browser sends them back. */
  cookie: string;
  /** The session token inside the signed cookie. */
  token: string;
}

async function signIn(): Promise<SignedIn> {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': freshAddress(),
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  const setCookies = response.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(';')[0]!).join('; ');
  const session = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  expect(session, 'a session cookie').toBeDefined();
  const token = decodeURIComponent(session!.split('=')[1]!.split(';')[0]!).split('.')[0]!;
  return { cookie, token };
}

/** As if the last request was `minutesAgo` minutes ago: the session ends 30 minutes after it. */
async function lastRequestAgo(token: string, minutesAgo: number): Promise<void> {
  const { rowCount } = await admin.query(
    `update sessions
        set expires_at = now() + make_interval(secs => $2) - make_interval(mins => $3),
            updated_at = now() - make_interval(mins => $3)
      where token = $1`,
    [token, SESSION_IDLE_SECONDS, minutesAgo],
  );
  expect(rowCount).toBe(1);
}

/** When the session ends, as the database has it, or null when the row is gone. */
async function sessionEnd(token: string): Promise<Date | null> {
  const { rows } = await admin.query<{ expires_at: Date }>(
    'select expires_at from sessions where token = $1',
    [token],
  );
  return rows[0]?.expires_at ?? null;
}

async function secondsLeft(token: string): Promise<number> {
  const { rows } = await admin.query<{ seconds: string }>(
    'select extract(epoch from (expires_at - now())) as seconds from sessions where token = $1',
    [token],
  );
  expect(rows, 'one session row').toHaveLength(1);
  return Number(rows[0]!.seconds);
}

/** A browser request for a staff page, through the request proxy. */
async function staffRequest(cookie: string | undefined, path = '/'): Promise<NextResponse> {
  const headers = new Headers({ 'x-forwarded-for': freshAddress() });
  if (cookie) headers.set('cookie', cookie);
  return proxy(new NextRequest(`${ORIGIN}${path}`, { headers }));
}

/** The session cookie a response sets, with its attributes, or undefined. */
const sessionCookieOf = (response: Response) =>
  response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));

describe('a staff request through the proxy', () => {
  it('moves the end of a session due for it forward, and renews the cookie with it', async () => {
    const { cookie, token } = await signIn();
    await lastRequestAgo(token, 20); // 10 minutes left; the cookie was set 20 minutes ago

    const response = await staffRequest(cookie);

    expect(getRedirectUrl(response), 'the page is served').toBeNull();
    const renewed = sessionCookieOf(response);
    expect(renewed, 'a renewed session cookie').toBeDefined();
    // The same session, now ending 30 minutes from this request, in the browser as in the database.
    expect(renewed).toContain(`${cookie.match(/chairside\.session_token=([^;]+)/)![1]}`);
    expect(renewed).toMatch(new RegExp(`Max-Age=${SESSION_IDLE_SECONDS}(;|$)`));
    expect(renewed).toMatch(/HttpOnly/i);
    expect(renewed).toMatch(/SameSite=Lax/i);
    expect(renewed).toMatch(/Path=\//);
    expect(await secondsLeft(token)).toBeGreaterThan(SESSION_IDLE_SECONDS - 60);
  });

  it('also renews the cookie on a server action (a POST to the page)', async () => {
    const { cookie, token } = await signIn();
    await lastRequestAgo(token, 5);

    const headers = new Headers({ cookie, 'x-forwarded-for': freshAddress() });
    const response = await proxy(
      new NextRequest(`${ORIGIN}/choose-clinic`, { method: 'POST', headers }),
    );

    expect(getRedirectUrl(response)).toBeNull();
    expect(sessionCookieOf(response)).toMatch(new RegExp(`Max-Age=${SESSION_IDLE_SECONDS}(;|$)`));
    expect(await secondsLeft(token)).toBeGreaterThan(SESSION_IDLE_SECONDS - 60);
  });

  it('leaves a session alone within a minute of its last move: no write, no cookie', async () => {
    const { cookie, token } = await signIn();
    const before = await sessionEnd(token);

    const response = await staffRequest(cookie);

    expect(getRedirectUrl(response)).toBeNull();
    expect(sessionCookieOf(response)).toBeUndefined();
    expect(await sessionEnd(token)).toEqual(before);
  });

  it('refuses a session past its end: to the login page, the cookie removed, never renewed', async () => {
    const { cookie, token } = await signIn();
    await lastRequestAgo(token, 31);

    const response = await staffRequest(cookie);

    expect(getRedirectUrl(response)).toBe(`${ORIGIN}/login`);
    const removed = sessionCookieOf(response);
    expect(removed, 'the session cookie is removed').toMatch(/Max-Age=0(;|$)/);
    expect(await sessionEnd(token), 'the expired session is deleted').toBeNull();

    // Sent again, the old cookie still gets nowhere.
    const again = await staffRequest(cookie);
    expect(getRedirectUrl(again)).toBe(`${ORIGIN}/login`);
    expect(sessionCookieOf(again) ?? '').not.toMatch(/Max-Age=[1-9]/);
  });

  it('sends a request without a session cookie, or with a forged one, to the login page', async () => {
    const without = await staffRequest(undefined);
    expect(getRedirectUrl(without)).toBe(`${ORIGIN}/login`);

    const forged = await staffRequest(`${SESSION_COOKIE}=not-a-signed-token`);
    expect(getRedirectUrl(forged)).toBe(`${ORIGIN}/login`);
    expect(sessionCookieOf(forged) ?? '').not.toMatch(/Max-Age=[1-9]/);
  });
});

describe('a staff page reading the session', () => {
  it('does not move its end: only the proxy does, together with the cookie', async () => {
    const { cookie, token } = await signIn();
    await lastRequestAgo(token, 20);
    const before = await sessionEnd(token);
    page.headers = new Headers({ cookie });

    const user = await currentUser();

    expect(user?.id).toBe(userId);
    expect(await sessionEnd(token)).toEqual(before);
  });

  it('still finds no user for a session past its end', async () => {
    const { cookie, token } = await signIn();
    await lastRequestAgo(token, 31);
    page.headers = new Headers({ cookie });

    expect(await currentUser()).toBeNull();
  });
});
