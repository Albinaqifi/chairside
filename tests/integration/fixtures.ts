import fs from 'node:fs';
import { inspect } from 'node:util';
import type { SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { expect, vi } from 'vitest';
import { newId } from '@/lib/ids';
import { getAuth } from '@/modules/auth';
import { testDatabase } from './test-database';

/**
 * A pool for the migration role. It owns the tables, so Row-Level Security does not apply to
 * it. Tests use it to set up rows and to check what really happened, never to test isolation.
 */
export function migratorPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDatabase().migratorUrl, max: 2 });
}

/** A pool for the app role used WITHOUT withTenant: to test what happens with no clinic set. */
export function appPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDatabase().appUrl, max: 2 });
}

/** Inserts a synthetic clinic and returns its id. */
export async function insertClinic(db: pg.Pool): Promise<string> {
  const id = newId();
  await db.query(
    `insert into clinics (id, name, timezone, locale, currency, default_country)
     values ($1, $2, 'Europe/Skopje', 'en', 'MKD', 'MK')`,
    [id, `Test clinic ${id.slice(-6)}`],
  );
  return id;
}

/** Inserts a synthetic audit row and returns its id. */
export async function insertAuditEntry(db: pg.Pool, clinicId: string): Promise<string> {
  const id = newId();
  await db.query(
    `insert into audit_log (id, clinic_id, at, actor_type, action)
     values ($1, $2, '2026-03-10T09:00:00Z', 'system', 'test.setup')`,
    [id, clinicId],
  );
  return id;
}

/**
 * The error a failed query throws, exactly as Drizzle and pg make it, values included: for tests
 * of what prints errors, such as the logger. Run outside withTenant, which since E00-T03 lets no
 * error out with the values a query was sent (D-070).
 */
export async function rawQueryError(db: pg.Pool, query: SQL): Promise<unknown> {
  return drizzle(db)
    .execute(query)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

/** The Postgres error code of an error, also when a library wrapped it (`cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  return pgErrorField(error, 'code');
}

/** The constraint a Postgres error names, also when a library wrapped it (`cause`). */
export function pgErrorConstraint(error: unknown): string | undefined {
  return pgErrorField(error, 'constraint');
}

function pgErrorField(error: unknown, field: 'code' | 'constraint'): string | undefined {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === 'string') return value;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Postgres error codes the tests expect. */
export const PG = {
  insufficientPrivilege: '42501', // also raised for row-level security violations
  lockNotAvailable: '55P03', // raised when lock_timeout ends a wait for a lock
  invalidCursorName: '34000', // the cursor does not exist (any more)
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
} as const;

/**
 * Expects the promise to fail with the given Postgres error code and, when one is given, naming
 * that constraint.
 */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected the database to refuse').toBeDefined();
  expect(pgErrorCode(error)).toBe(code);
  if (constraint !== undefined) expect(pgErrorConstraint(error)).toBe(constraint);
}

/** A synthetic staff email that no real person can have. */
export function testEmail(): string {
  return `staff-${newId().slice(-12)}@example.test`;
}

/** The app's origin in tests: BETTER_AUTH_URL in vitest.config.ts. */
export const ORIGIN = 'http://localhost:3000';

/**
 * Signs a user in through the auth library's own handler, as the browser does, and returns the
 * Cookie header the browser would send back. `address` is the client address the sign-in rate
 * limit counts: give each sign-in one no other test uses.
 */
export async function signInCookie(
  email: string,
  password: string,
  address: string,
): Promise<string> {
  const response = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-forwarded-for': address },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status, 'signed in').toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ');
}

/**
 * Where a call sent the browser with Next.js's redirect(), or undefined when it returned. Any
 * other error is thrown again.
 */
export async function redirectOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
    return undefined;
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT;')) throw error;
    return digest.split(';').slice(2, -2).join(';'); // NEXT_REDIRECT;<type>;<url>;<status>;
  }
}

/**
 * Everything written to the console, stdout and stderr while `fn` runs, as text, and what `fn`
 * returned. Our logger (pino) writes to the file descriptors directly, so those writes are read
 * too. An error that escapes counts as output: whatever catches it prints it. Mocks are restored
 * at the end.
 */
export async function captureOutput<T>(
  fn: () => Promise<T>,
): Promise<{ output: string; result: T | undefined }> {
  const written: string[] = [];
  const keep = (...args: unknown[]) => void written.push(args.map((a) => inspect(a)).join(' '));
  const spies: { mockRestore(): void }[] = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(vi.spyOn(console, method).mockImplementation(keep));
  }
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    spies.push(
      vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        written.push(String(chunk));
        return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write),
    );
  }
  const writeSync = fs.writeSync;
  spies.push(
    vi.spyOn(fs, 'writeSync').mockImplementation(((
      fd: unknown,
      data: unknown,
      ...rest: unknown[]
    ) => {
      if (fd === 1 || fd === 2) written.push(String(data));
      return (writeSync as (...a: unknown[]) => number)(fd, data, ...rest);
    }) as typeof fs.writeSync),
  );
  const writeAsync = fs.write;
  spies.push(
    vi.spyOn(fs, 'write').mockImplementation(((fd: unknown, data: unknown, ...rest: unknown[]) => {
      if (fd === 1 || fd === 2) written.push(String(data));
      return (writeAsync as (...a: unknown[]) => void)(fd, data, ...rest);
    }) as typeof fs.write),
  );
  let result: T | undefined;
  try {
    result = await fn();
  } catch (error) {
    written.push(inspect(error));
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return { output: written.join('\n'), result };
}

/**
 * Runs `fn` while the app role lacks one grant. The migrator owns the tables and functions, so
 * it can take a grant away and give it back. Test files run one after another, so no other test
 * sees the gap.
 */
export async function withoutGrant<T>(
  db: pg.Pool,
  grant: string,
  on: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`revoke ${grant} on ${on} from chairside_app`);
  try {
    return await fn();
  } finally {
    await db.query(`grant ${grant} on ${on} to chairside_app`);
  }
}

/**
 * Inserts a membership, linked to a provider when `providerId` is given. The app role only reads
 * memberships, so this uses the migrator.
 */
export async function insertMembership(
  db: pg.Pool,
  membership: {
    clinicId: string;
    userId: string;
    role?: string;
    status?: string;
    extraPermissions?: string[];
    providerId?: string;
  },
): Promise<string> {
  const id = newId();
  await db.query(
    `insert into memberships (id, clinic_id, user_id, role, status, extra_permissions, provider_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      membership.clinicId,
      membership.userId,
      membership.role ?? 'front_desk',
      membership.status ?? 'active',
      membership.extraPermissions ?? [],
      membership.providerId ?? null,
    ],
  );
  return id;
}
