import { getRedirectUrl } from 'next/experimental/testing/server';
import { NextRequest, type NextResponse } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { staffAction, staffRead, userAction } from '@/app/_lib/actions';
import { closeDb } from '@/db/client';
import { newId } from '@/lib/ids';
import { createStaffUser, SESSION_IDLE_SECONDS } from '@/modules/auth';
import { proxy } from '@/proxy';
import {
  insertClinic,
  insertMembership,
  migratorPool,
  ORIGIN,
  redirectOf,
  signInCookie,
  testEmail,
} from './fixtures';

// E00-T08: an action sent after the session ended. The browser follows a redirect from the proxy
// as a POST to /login, where a form posted without JavaScript gets an error (500) instead of the
// login page. So the proxy lets a server action through without a valid session; the action's
// wrapper runs nothing and sends the person to the login page (D-071). Pages still go to the login
// page from the proxy. Only next/headers is replaced, as there is no running Next.js; the tester
// checks the browser's side once in a real browser. Every value is synthetic.

const PASSWORD = 'MARKER-pw-0b7c-correct';
const SESSION_COOKIE = 'chairside.session_token';

// What the action's request carries: the session cookie, and the clinic picked earlier.
const request = vi.hoisted(() => ({ cookie: '', clinic: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers(request.cookie ? { cookie: request.cookie } : {})),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'chairside.clinic' && request.clinic ? { name, value: request.clinic } : undefined,
    }),
}));

const admin = migratorPool();
let clinicId: string;
let email: string;
let userId: string;

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.34.0.${nextAddress++}`;

beforeAll(async () => {
  clinicId = await insertClinic(admin);
  email = testEmail();
  ({ id: userId } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD }));
  await insertMembership(admin, { clinicId, userId });
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

// ---- Actions made for the tests: each counts its runs, so "nothing ran" can be seen ----

let runs = 0;
beforeEach(() => {
  runs = 0;
});

const markInput = z.object({ markId: z.uuid() });
const mark = staffAction(
  {
    permission: 'every_member',
    input: markInput,
    audit: {
      action: 'test.marked',
      entityType: 'test_mark',
      entityId: ({ input }) => input.markId,
    },
  },
  async ({ input }) => {
    runs += 1;
    return { markId: input.markId };
  },
);
const readMark = staffRead({ permission: 'every_member', input: markInput }, async ({ input }) => {
  runs += 1;
  return { markId: input.markId };
});
const pickMark = userAction({ input: markInput }, async ({ input }) => {
  runs += 1;
  return { markId: input.markId };
});

// ---- Sessions ----

/** A fresh session's cookie, as the browser sends it back. */
const signedIn = () => signInCookie(email, PASSWORD, freshAddress());

/** The session token inside the signed session cookie (`token.signature`, URL-encoded). */
function tokenOf(cookie: string): string {
  const value = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  expect(value, 'a session cookie').toBeDefined();
  return decodeURIComponent(value!).split('.')[0]!;
}

/** Ends the session as 30 minutes without a request would: its end is a minute ago. */
async function expire(cookie: string): Promise<void> {
  const { rowCount } = await admin.query(
    `update sessions
        set expires_at = now() - interval '1 minute',
            updated_at = now() - make_interval(secs => $2) - interval '1 minute'
      where token = $1`,
    [tokenOf(cookie), SESSION_IDLE_SECONDS],
  );
  expect(rowCount).toBe(1);
}

/** Ends the session as signing out in another tab would: its row is gone. */
async function remove(cookie: string): Promise<void> {
  const { rowCount } = await admin.query('delete from sessions where token = $1', [
    tokenOf(cookie),
  ]);
  expect(rowCount).toBe(1);
}

// ---- Requests through the proxy ----

/** A server action as the page calls it: a POST with the action's id in the Next-Action header. */
function actionCall(cookie: string): Promise<NextResponse> {
  const headers = new Headers({
    'next-action': '7f00c0ffee00000000000000000000000000000001',
    'content-type': 'text/plain;charset=UTF-8',
    accept: 'text/x-component',
    'x-forwarded-for': freshAddress(),
  });
  if (cookie) headers.set('cookie', cookie);
  return proxy(new NextRequest(`${ORIGIN}/`, { method: 'POST', headers, body: '[]' }));
}

/**
 * A form posted without JavaScript: multipart/form-data (the request sets it from the body), the
 * action's id one of its fields.
 */
async function formPost(cookie: string): Promise<NextResponse> {
  const form = new FormData();
  form.set('$ACTION_ID_7f00c0ffee00000000000000000000000000000001', '');
  form.set('markId', newId());
  const headers = new Headers({ 'x-forwarded-for': freshAddress() });
  if (cookie) headers.set('cookie', cookie);
  const post = new NextRequest(`${ORIGIN}/choose-clinic`, { method: 'POST', headers, body: form });
  expect(post.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
  return proxy(post);
}

/** A staff page as the browser asks for it. */
function pageRequest(cookie: string): Promise<NextResponse> {
  const headers = new Headers({ 'x-forwarded-for': freshAddress() });
  if (cookie) headers.set('cookie', cookie);
  return proxy(new NextRequest(`${ORIGIN}/`, { headers }));
}

const passedOn = (response: NextResponse) => response.headers.get('x-middleware-next') === '1';

/** The session cookie a response sets, with its attributes, or undefined. */
const sessionCookieOf = (response: Response) =>
  response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));

/** Every action made for the tests, called with the ended session: where each one sent the person. */
async function eachActionWith(cookie: string): Promise<(string | undefined)[]> {
  request.cookie = cookie;
  request.clinic = clinicId;
  const input = { markId: newId() };
  return [
    await redirectOf(mark(clinicId, input)),
    await redirectOf(readMark(clinicId, input)),
    await redirectOf(pickMark(input)),
  ];
}

async function auditRows(entityId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from audit_log where entity_id = $1',
    [entityId],
  );
  return rows[0]!.n;
}

describe('a server action sent after the session ended', () => {
  it('past its end: the proxy lets it through, removing the cookie, and the action sends the person to the login page with nothing run', async () => {
    const cookie = await signedIn();
    await expire(cookie);

    const response = await actionCall(cookie);

    expect(getRedirectUrl(response), 'no redirect from the proxy').toBeNull();
    expect(passedOn(response), 'passed on to the action').toBe(true);
    expect(sessionCookieOf(response), 'the session cookie is removed').toMatch(/Max-Age=0(;|$)/);
    expect(await eachActionWith(cookie)).toEqual(['/login', '/login', '/login']);
    expect(runs, 'no handler ran').toBe(0);
  });

  it('signed out in another tab: the same', async () => {
    const cookie = await signedIn();
    await remove(cookie);

    const response = await actionCall(cookie);

    expect(getRedirectUrl(response)).toBeNull();
    expect(passedOn(response)).toBe(true);
    expect(sessionCookieOf(response) ?? '', 'never a renewed cookie').not.toMatch(/Max-Age=[1-9]/);
    expect(await eachActionWith(cookie)).toEqual(['/login', '/login', '/login']);
    expect(runs).toBe(0);
  });

  it('without a session cookie at all: the same', async () => {
    const response = await actionCall('');

    expect(getRedirectUrl(response)).toBeNull();
    expect(passedOn(response)).toBe(true);
    expect(await eachActionWith('')).toEqual(['/login', '/login', '/login']);
    expect(runs).toBe(0);
  });

  it('as a form posted without JavaScript: the same', async () => {
    const cookie = await signedIn();
    await expire(cookie);

    const response = await formPost(cookie);

    expect(getRedirectUrl(response)).toBeNull();
    expect(passedOn(response)).toBe(true);
    expect(await eachActionWith(cookie)).toEqual(['/login', '/login', '/login']);
    expect(runs).toBe(0);
  });

  it('writes no audit row', async () => {
    const cookie = await signedIn();
    await expire(cookie);
    request.cookie = cookie;
    request.clinic = clinicId;
    const markId = newId();

    expect(await redirectOf(mark(clinicId, { markId }))).toBe('/login');

    expect(await auditRows(markId)).toBe(0);
  });
});

describe('what the proxy still sends to the login page itself', () => {
  it('a staff page with an ended session, with the cookie removed', async () => {
    const cookie = await signedIn();
    await expire(cookie);

    const response = await pageRequest(cookie);

    expect(getRedirectUrl(response)).toBe(`${ORIGIN}/login`);
    expect(sessionCookieOf(response)).toMatch(/Max-Age=0(;|$)/);
  });

  it('a POST that is no server action', async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      'x-forwarded-for': freshAddress(),
    });
    const response = await proxy(
      new NextRequest(`${ORIGIN}/`, { method: 'POST', headers, body: '{}' }),
    );

    expect(getRedirectUrl(response)).toBe(`${ORIGIN}/login`);
  });

  it('while a live session still runs the action as before', async () => {
    const cookie = await signedIn();

    const response = await actionCall(cookie);
    request.cookie = cookie;
    request.clinic = clinicId;
    const markId = newId();

    expect(passedOn(response)).toBe(true);
    expect(await mark(clinicId, { markId })).toEqual({ ok: true, value: { markId } });
    expect(runs).toBe(1);
  });
});
