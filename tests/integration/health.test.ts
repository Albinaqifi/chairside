// First, as in a running Next.js server: next/server (through the proxy's config) replaces how errors
// are inspected, and the replacement needs the AsyncLocalStorage global this file sets up.
import 'next/dist/server/node-environment-baseline';
import { inspect } from 'node:util';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as healthRoute from '@/app/api/health/route';
import { closeDb } from '@/db/client';
import { logger } from '@/lib/logger';
import { AUTH_SECRET_MIN_LENGTH, EXAMPLE_AUTH_SECRET } from '@/modules/auth';
import { config } from '@/proxy';
import { ORIGIN } from './fixtures';
import { testDatabase } from './test-database';

// E00-T07a, acceptance 4 and 5: `/api/health`, the host's check of the web (D-102), called as Next.js
// calls a route handler, against the integration tests' database. Each case names DATABASE_URL or the
// auth settings for one call, on a pool made for them. The roles it makes are synthetic and dropped
// again; the passwords are markers. The browser's side (no redirect, the 405, a staff page signed
// out): tests/e2e/health.spec.ts.

const database = testDatabase();
const superuser = new pg.Pool({ connectionString: database.adminUrl, max: 1 });

/** The password of the roles made here, a marker no log line may hold. */
const ROLE_PASSWORD = 'MARKER-health-7d3e-role';

/**
 * Roles that get past the policies, each a login: one with BYPASSRLS, and two members of the
 * migration role, which owns the tables: one that inherits its privileges, one that can only SET
 * ROLE to it. Cluster-wide, so made with names of their own and dropped afterwards.
 */
const ROLES = {
  bypass: { name: 'chairside_health_bypass', create: 'LOGIN NOINHERIT BYPASSRLS' },
  member: {
    name: 'chairside_health_member',
    create: 'LOGIN INHERIT',
    grant: 'WITH INHERIT TRUE, SET TRUE',
  },
  memberThatSetsRole: {
    name: 'chairside_health_set_role',
    create: 'LOGIN NOINHERIT',
    grant: 'WITH INHERIT FALSE, SET TRUE',
  },
} as const;

/** The test database, as `user` with `password`. */
function urlAs(user: string, password: string): string {
  const url = new URL(database.appUrl);
  url.username = user;
  url.password = password;
  return url.href;
}

async function dropRoles(): Promise<void> {
  for (const { name } of Object.values(ROLES)) {
    await superuser.query(`drop role if exists ${pg.escapeIdentifier(name)}`);
  }
}

beforeAll(async () => {
  await dropRoles(); // left by a run that stopped halfway
  for (const role of Object.values(ROLES)) {
    const name = pg.escapeIdentifier(role.name);
    await superuser.query(
      `create role ${name} ${role.create} password ${pg.escapeLiteral(ROLE_PASSWORD)}`,
    );
    if ('grant' in role) await superuser.query(`grant chairside_migrator to ${name} ${role.grant}`);
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeDb(); // the next call makes a pool from the settings it names
});

afterAll(async () => {
  await dropRoles();
  await superuser.end();
});

interface HealthAnswer {
  status: number;
  /** The body as sent. */
  text: string;
  cacheControl: string | null;
  setCookie: string[];
  /** Each line the check gave the logger, at any level: its fields and its message. */
  logged: { fields: unknown; message: unknown }[];
  /** All it gave the logger, as text: every error with its message, stack and fields. */
  loggedText: string;
}

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * Calls GET /api/health once, with these settings on top of the tests' own for that call alone, on a
 * pool made for them, and reads its answer.
 */
async function health(settings: Record<string, string | undefined> = {}): Promise<HealthAnswer> {
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
  await closeDb();
  const spies = LEVELS.map((level) => vi.spyOn(logger, level).mockImplementation(() => undefined));
  try {
    const response = await healthRoute.GET();
    const calls = spies.flatMap((spy) => spy.mock.calls as unknown[][]);
    return {
      status: response.status,
      text: await response.text(),
      cacheControl: response.headers.get('cache-control'),
      setCookie: response.headers.getSetCookie(),
      logged: calls.map(([fields, message]) => ({ fields, message })),
      loggedText: inspect(calls, { depth: null }),
    };
  } finally {
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllEnvs();
  }
}

/** A 503 that names no reason, and the one log line that names it by `code`. */
function expectFailure(answer: HealthAnswer, code: string): void {
  expect(answer.status).toBe(503);
  expect(answer.text, 'the same body for every failure').toBe('{"ok":false}');
  expect(answer.cacheControl).toBe('no-store');
  expect(answer.setCookie).toEqual([]);
  expect(answer.logged, 'one log line').toHaveLength(1);
  expect(answer.logged[0]).toMatchObject({ fields: { code }, message: 'health check failed' });
}

describe('GET /api/health', () => {
  it('answers 200 as the app role, sets no cookie, is never cached and logs nothing', async () => {
    const answer = await health();
    expect(answer.status).toBe(200);
    expect(answer.text).toBe('{"ok":true}');
    expect(answer.cacheControl).toBe('no-store');
    expect(answer.setCookie).toEqual([]);
    expect(answer.logged).toEqual([]);
  });

  it('answers each request anew: never at build time, never from a cache', async () => {
    expect(healthRoute.dynamic).toBe('force-dynamic');
    expect((await health()).status).toBe(200);
    expect((await health({ DATABASE_URL: database.migratorUrl })).status).toBe(503);
    expect((await health()).status).toBe(200);
  });

  it('answers 503 when the database cannot be reached, and logs no password', async () => {
    // Nothing listens on port 1 of this machine.
    const answer = await health({
      DATABASE_URL: `postgres://chairside_app:${ROLE_PASSWORD}@127.0.0.1:1/${database.name}`,
    });
    expectFailure(answer, 'database_unreachable');
    expect(answer.loggedText).not.toContain(ROLE_PASSWORD);
  });

  it('answers 503 when DATABASE_URL is not set', async () => {
    expectFailure(await health({ DATABASE_URL: undefined }), 'database_unreachable');
  });

  it.each([
    { login: 'the migration role, which owns the tables', url: () => database.migratorUrl },
    {
      login: 'a superuser',
      url: () => {
        const url = new URL(database.adminUrl);
        url.pathname = `/${database.name}`;
        return url.href;
      },
    },
    { login: 'a role with BYPASSRLS', url: () => urlAs(ROLES.bypass.name, ROLE_PASSWORD) },
    {
      login: 'a member of the migration role that inherits its privileges',
      url: () => urlAs(ROLES.member.name, ROLE_PASSWORD),
    },
    {
      login: 'a member of the migration role that does not inherit them but can SET ROLE to it',
      url: () => urlAs(ROLES.memberThatSetsRole.name, ROLE_PASSWORD),
    },
  ])('answers 503 when DATABASE_URL names $login', async ({ url }) => {
    const answer = await health({ DATABASE_URL: url() });
    expectFailure(answer, 'database_login_past_policies');
    expect(answer.loggedText).not.toContain(ROLE_PASSWORD);
  });

  it("answers 503 with .env.example's secret on https, and logs no secret", async () => {
    const answer = await health({
      BETTER_AUTH_URL: 'https://chairside.example.test',
      BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET,
    });
    expectFailure(answer, 'auth_secret_example');
    expect(answer.loggedText).not.toContain(EXAMPLE_AUTH_SECRET);
  });

  it('answers 503 with a secret of 31 characters on https, and 200 with one of 32', async () => {
    const short = `MARKER-${'s'.repeat(AUTH_SECRET_MIN_LENGTH - 8)}`; // 31 characters
    const answer = await health({
      BETTER_AUTH_URL: 'https://chairside.example.test',
      BETTER_AUTH_SECRET: short,
    });
    expectFailure(answer, 'auth_secret_short');
    expect(answer.loggedText).not.toContain(short);

    const longEnough = await health({
      BETTER_AUTH_URL: 'https://chairside.example.test',
      BETTER_AUTH_SECRET: `${short}s`,
    });
    expect(longEnough.status).toBe(200);
  });

  it("answers 200 with .env.example's secret over http, as on this machine", async () => {
    const answer = await health({
      BETTER_AUTH_URL: ORIGIN,
      BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET,
    });
    expect(answer.status).toBe(200);
  });

  it('answers 503 when an auth setting is missing', async () => {
    expectFailure(await health({ BETTER_AUTH_SECRET: undefined }), 'auth_settings_missing');
    expectFailure(await health({ BETTER_AUTH_URL: '' }), 'auth_settings_missing');
  });

  it('takes GET alone: Next.js answers 405 to a POST or any other method', () => {
    // Next.js runs HEAD as GET and answers OPTIONS itself; the end-to-end check sends the POST.
    expect(Object.keys(healthRoute).sort()).toEqual(['GET', 'dynamic']);
  });
});

describe("the request proxy's matcher", () => {
  const proxied = (path: string) =>
    unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}` });

  it('lets /api/health through untouched', () => {
    expect(proxied('/api/health')).toBe(false);
    expect(proxied('/api/health?probe=1')).toBe(false);
  });

  it('still runs for every other path as before, those that start like it too', () => {
    for (const path of ['/', '/patients', '/api/healthz', '/api/health/x', '/api/healthcare']) {
      expect(proxied(path), path).toBe(true);
    }
    for (const path of ['/login', '/login/set-password', '/api/auth/get-session']) {
      expect(proxied(path), path).toBe(false);
    }
  });
});
