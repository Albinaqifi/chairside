import { NextRequest, type NextResponse } from 'next/server';
import { getRedirectUrl } from 'next/experimental/testing/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

// Tester, E00-T02 fix round 2. The tests above look at one response at a time. A browser keeps a
// cookie only until its Max-Age runs out, and curl ignores Max-Age, so neither shows what the
// reviewer found. This is a browser's cookie jar over a working morning, on a fake clock (only
// Date is faked: the library reads the time through Date).

/** A browser's cookies for this origin: each kept until its Max-Age or Expires runs out. */
class CookieJar {
  private readonly cookies = new Map<string, { value: string; until: number }>();

  /** Takes every Set-Cookie of a response, as a browser does (Max-Age wins over Expires). */
  take(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      const maxAge = attributes.find((a) => /^max-age=/i.test(a));
      const expires = attributes.find((a) => /^expires=/i.test(a));
      let until = Number.POSITIVE_INFINITY;
      if (maxAge) until = Date.now() + Number(maxAge.slice('max-age='.length)) * 1000;
      else if (expires) until = new Date(expires.slice('expires='.length)).getTime();
      if (until <= Date.now()) this.cookies.delete(name);
      else this.cookies.set(name, { value, until });
    }
  }

  /** The Cookie header the browser sends now; cookies past their end are gone. */
  header(): string {
    for (const [name, cookie] of this.cookies) {
      if (cookie.until <= Date.now()) this.cookies.delete(name);
    }
    return [...this.cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
  }

  /** When the browser drops the cookie, in milliseconds. */
  until(name: string): number | undefined {
    return this.cookies.get(name)?.until;
  }
}

describe('a browser over a working morning', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function signInInto(jar: CookieJar): Promise<string> {
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
    jar.take(response);
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    return decodeURIComponent(cookie!.split('=')[1]!.split(';')[0]!).split('.')[0]!;
  }

  it('stays signed in while requests keep coming, and is signed out 30 minutes after the last', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Europe/Skopje leaves summer time at 03:00 on 25 October 2026 (01:00 UTC); the morning
    // crosses it. Nothing here may depend on local time.
    const start = new Date('2026-10-25T00:20:00Z').getTime();
    vi.setSystemTime(start);
    const jar = new CookieJar();
    const token = await signInInto(jar);

    // A request every 4 minutes for two hours: page loads, client-side navigations, actions.
    for (let minute = 4; minute <= 120; minute += 4) {
      vi.setSystemTime(start + minute * 60_000);
      const sent = jar.header();
      expect(sent, `the browser still has the cookie after ${minute} minutes`).toContain(
        `${SESSION_COOKIE}=`,
      );

      const response = await staffRequest(sent);
      expect(getRedirectUrl(response), `served after ${minute} minutes`).toBeNull();
      jar.take(response);
      page.headers = new Headers({ cookie: jar.header() });
      expect((await currentUser())?.id, `the page knows the user after ${minute} minutes`).toBe(
        userId,
      );

      // The cookie and the session end together: the browser never drops a live session's cookie.
      const end = await sessionEnd(token);
      expect(end, 'the session row').not.toBeNull();
      expect(jar.until(SESSION_COOKIE)).toBe(end!.getTime());
      expect(end!.getTime()).toBe(Date.now() + SESSION_IDLE_SECONDS * 1000);
    }

    // Then nobody touches the computer. 30 minutes and a second later the browser has dropped
    // the cookie, and a client that kept it anyway gets nowhere either.
    const kept = jar.header();
    vi.setSystemTime(start + (120 + 30) * 60_000 + 1000);
    expect(jar.header()).not.toContain(`${SESSION_COOKIE}=`);
    page.headers = new Headers({ cookie: kept });
    expect(await currentUser()).toBeNull();
    expect(getRedirectUrl(await staffRequest(kept))).toBe(`${ORIGIN}/login`);
  });

  it('serves several requests at once on a session due for its move, keeping one session', async () => {
    const jar = new CookieJar();
    const token = await signInInto(jar);
    await lastRequestAgo(token, 10);
    const sent = jar.header();

    const responses = await Promise.all(Array.from({ length: 6 }, () => staffRequest(sent)));

    for (const response of responses) {
      expect(getRedirectUrl(response)).toBeNull();
      expect(sessionCookieOf(response) ?? '', 'never a removal').not.toMatch(/Max-Age=0(;|$)/);
    }
    const { rows } = await admin.query('select 1 from sessions where token = $1', [token]);
    expect(rows, 'still one session').toHaveLength(1);
    expect(await secondsLeft(token)).toBeGreaterThan(SESSION_IDLE_SECONDS - 60);
  });
});
