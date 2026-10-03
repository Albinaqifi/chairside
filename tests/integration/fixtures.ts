import pg from 'pg';
import { expect } from 'vitest';
import { newId } from '@/lib/ids';
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

/** The Postgres error code of an error, also when a library wrapped it (`cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
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
} as const;

/** Expects the promise to fail with the given Postgres error code. */
export async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected the database to refuse').toBeDefined();
  expect(pgErrorCode(error)).toBe(code);
}

/** A synthetic staff email that no real person can have. */
export function testEmail(): string {
  return `staff-${newId().slice(-12)}@example.test`;
}

/** Inserts a membership. The app role only reads memberships in E00-T02, so this uses the migrator. */
export async function insertMembership(
  db: pg.Pool,
  membership: {
    clinicId: string;
    userId: string;
    role?: string;
    status?: string;
    extraPermissions?: string[];
  },
): Promise<string> {
  const id = newId();
  await db.query(
    `insert into memberships (id, clinic_id, user_id, role, status, extra_permissions)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      membership.clinicId,
      membership.userId,
      membership.role ?? 'front_desk',
      membership.status ?? 'active',
      membership.extraPermissions ?? [],
    ],
  );
  return id;
}
