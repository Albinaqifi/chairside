// First, as in a running Next.js server: next/server replaces how errors are inspected, and the
// replacement needs the AsyncLocalStorage global this file sets up.
import 'next/dist/server/node-environment-baseline';
import fs from 'node:fs';
import { inspect } from 'node:util';
import { getRedirectUrl } from 'next/experimental/testing/server';
import { NextRequest, type NextResponse } from 'next/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { createStaffUser, getAuth, SESSION_IDLE_SECONDS } from '@/modules/auth';
import { proxy } from '@/proxy';
import { migratorPool, testEmail } from './fixtures';

// Tester, E00-T02 fix round 2 (D-067): the request proxy is now the one place a session is moved
// forward. A session that disappears while it is moved, or a read that fails, must never let the
// request through, renew the cookie or print the session token. Every value here is synthetic.

const ORIGIN = 'http://localhost:3000'; // BETTER_AUTH_URL in vitest.config.ts
const PASSWORD = 'MARKER-pw-3e9a-correct';
const SESSION_COOKIE = 'chairside.session_token';

const admin = migratorPool();
let email: string;

let nextAddress = 1;
/** A client address no other test has used, so rate-limit counters never cross tests. */
const freshAddress = () => `203.0.113.${nextAddress++}`;

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

/** Signs in, then makes the session due for its move: as if the last request was 5 minutes ago. */
async function dueSession(): Promise<{ cookie: string; token: string }> {
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
  const session = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  expect(session, 'a session cookie').toBeDefined();
  const token = decodeURIComponent(session!.split('=')[1]!.split(';')[0]!).split('.')[0]!;
  const { rowCount } = await admin.query(
    `update sessions
        set expires_at = now() + make_interval(secs => $2) - interval '5 minutes',
            updated_at = now() - interval '5 minutes'
      where token = $1`,
    [token, SESSION_IDLE_SECONDS],
  );
  expect(rowCount).toBe(1);
  return { cookie: setCookies.map((c) => c.split(';')[0]!).join('; '), token };
}

/** A browser request for a staff page, through the request proxy. */
const staffPage = (cookie: string): Promise<NextResponse> =>
  proxy(new NextRequest(`${ORIGIN}/`, { headers: { cookie, 'x-forwarded-for': freshAddress() } }));

/** A session cookie on the response that the browser would keep (not a removal). */
const renewedCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !/Max-Age=0(;|$)/.test(c));

async function secondsLeft(token: string): Promise<number> {
  const { rows } = await admin.query<{ seconds: string }>(
    'select extract(epoch from (expires_at - now())) as seconds from sessions where token = $1',
    [token],
  );
  expect(rows, 'one session row').toHaveLength(1);
  return Number(rows[0]!.seconds);
}

// The same two helpers as in auth-attacks.test.ts.

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

// The migrator owns the tables, so it can take a grant away from the app role for one request.
async function withoutGrant(grant: string, table: string, fn: () => Promise<unknown>) {
  await admin.query(`revoke ${grant} on ${table} from chairside_app`);
  try {
    await fn();
  } finally {
    await admin.query(`grant ${grant} on ${table} to chairside_app`);
  }
}

describe('the request proxy reading the session', () => {
  it('sends to the login page, never renewed, a session signed out while it is moved forward', async () => {
    const { cookie, token } = await dueSession();
    // Signed out in another tab at the worst moment: after the proxy has read the session and
    // before its move is written. A row lock holds the move until the other tab's delete commits.
    const otherTab = await admin.connect();
    try {
      await otherTab.query('begin');
      await otherTab.query('select 1 from sessions where token = $1 for update', [token]);
      const { rows } = await otherTab.query<{ pid: number }>('select pg_backend_pid() as pid');
      const otherTabPid = rows[0]!.pid;

      let answered = false;
      const pending = Promise.resolve(staffPage(cookie)).finally(() => (answered = true));
      // Wait until the proxy's move is blocked behind the other tab.
      for (let waited = 0; ; waited += 20) {
        const { rows: blocked } = await admin.query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [otherTabPid],
        );
        if (blocked[0]!.n > 0) break;
        expect(answered, 'the proxy answered without trying to move the session').toBe(false);
        expect(waited, 'the proxy never reached the move').toBeLessThan(5000);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await otherTab.query('delete from sessions where token = $1', [token]);
      await otherTab.query('commit');

      const response = await pending;
      expect(getRedirectUrl(response)).toBe(`${ORIGIN}/login`);
      expect(renewedCookie(response), 'no cookie kept for a session that is gone').toBeUndefined();
      expect(
        response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)),
        'the cookie is removed',
      ).toMatch(/Max-Age=0(;|$)/);
      expect(getRedirectUrl(await staffPage(cookie)), 'and it stays gone').toBe(`${ORIGIN}/login`);
    } finally {
      await otherTab.query('rollback').catch(() => undefined);
      otherTab.release();
    }
  });

  it('ends the request with an error when the session cannot be read, printing no token', async () => {
    const { cookie, token } = await dueSession();
    let response: NextResponse | undefined;
    const output = await captureOutput(() =>
      withoutGrant('select', 'sessions', async () => {
        response = await staffPage(cookie);
      }),
    );
    expect(response, 'never answered as signed in, nor with a cookie').toBeUndefined();
    expect(output).toContain('Failed query');
    expect(output).toContain('The session could not be read');
    expect(output).not.toContain(token);
  });

  it('ends the request with an error when the move cannot be written, printing no token', async () => {
    const { cookie, token } = await dueSession();
    const before = await secondsLeft(token);
    let response: NextResponse | undefined;
    const output = await captureOutput(() =>
      withoutGrant('update', 'sessions', async () => {
        response = await staffPage(cookie);
      }),
    );
    expect(response, 'never answered as signed in, nor with a renewed cookie').toBeUndefined();
    expect(output).toContain('Failed query');
    expect(output).toContain('The session could not be read');
    expect(output).not.toContain(token);
    expect(await secondsLeft(token), 'the end was not moved').toBeLessThanOrEqual(before);
  });
});
