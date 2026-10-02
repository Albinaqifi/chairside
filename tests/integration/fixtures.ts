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
