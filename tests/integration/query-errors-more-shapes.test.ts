import { inspect } from 'node:util';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { clinicsForUser } from '@/modules/auth';
import { captureOutput, insertClinic, migratorPool, pgErrorCode, rawQueryError } from './fixtures';

// Added by the tester (E00-T03, D-070): more of the ways PostgreSQL puts a value it was sent into
// an error, beyond query-errors-at-source.test.ts. None may leave withTenant() or
// clinicsForUser() with that value. Values are synthetic markers.
const MARKER = 'MARKER-4b9e';
const NUMBER_MARKER = '987654321987654321'; // a number shows only as itself

const admin = migratorPool();
let clinicId: string;

beforeAll(async () => {
  clinicId = await insertClinic(admin);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** How Node prints an error: message, stack, own fields and the whole cause chain. */
const printed = (error: unknown) => inspect(error, { depth: 20 });

/** The error a promise rejects with. */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable('meant to fail'),
    (error: unknown) => error,
  );
}

// Each query fails the same way for the app role inside withTenant and, for the guard, for the
// migration role outside it.
const failures: { name: string; query: () => SQL; value: string; code: string }[] = [
  {
    name: 'a number out of range (22003)',
    query: () => sql`select ${NUMBER_MARKER}::int`,
    value: NUMBER_MARKER,
    code: '22003',
  },
  {
    name: 'a date it cannot read (22007)',
    query: () => sql`select ${MARKER}::date`,
    value: MARKER,
    code: '22007',
  },
  {
    name: 'an unknown time zone (22023)',
    query: () => sql`select now() at time zone ${MARKER}`,
    value: MARKER,
    code: '22023',
  },
  {
    name: 'a value that is not a boolean (22P02)',
    query: () => sql`select ${MARKER}::boolean`,
    value: MARKER,
    code: '22P02',
  },
  {
    name: 'a malformed list (22P02)',
    query: () => sql`select ${`{${MARKER}`}::int[]`,
    value: MARKER,
    code: '22P02',
  },
  {
    name: 'a missing value, with the row quoted in the detail (23502)',
    query: () => sql`
      insert into audit_log (id, clinic_id, at, actor_type, action, metadata)
      select gen_random_uuid(), id, now(), 'system', null, jsonb_build_object('k', ${MARKER}::text)
        from clinics where id = ${clinicId}`,
    value: MARKER,
    code: '23502',
  },
];

describe('a failed query inside withTenant, in more of the ways PostgreSQL quotes a value', () => {
  it.each(failures)('throws $name without the value', async ({ query, value, code }) => {
    // Guards the test: outside withTenant, the same failure carries the value.
    expect(printed(await rawQueryError(admin, query()))).toContain(value);

    const error = await errorOf(withTenant(clinicId, (tx) => tx.execute(query())));

    expect(printed(error)).not.toContain(value);
    expect(pgErrorCode(error)).toBe(code);
  });
});

describe('a connection that ends in the middle of a query', () => {
  it('throws, and prints, nothing that the query was sent', async () => {
    // The statement ends its own server process, with the marker among the values it was sent.
    // Drizzle then throws the failed rollback's error instead of the query's (D-071); whatever it
    // throws or logs on the way, through withTenant, holds no value.
    const { output, result } = await captureOutput(() =>
      errorOf(
        withTenant(clinicId, (tx) =>
          tx.execute(sql`select pg_terminate_backend(pg_backend_pid()), ${MARKER}::text`),
        ),
      ),
    );

    expect(result).toBeInstanceOf(Error);
    expect(printed(result)).not.toContain(MARKER);
    expect(output).toContain('withTenant: database connection'); // what happened was logged
    expect(output).not.toContain(MARKER);
  });
});

describe('clinicsForUser, given a value that is not a user id', () => {
  it('refuses it without repeating it', async () => {
    const error = await errorOf(clinicsForUser(`${MARKER}-not-a-uuid`));

    expect(error).toBeInstanceOf(TypeError);
    expect(printed(error)).not.toContain(MARKER);
  });
});
