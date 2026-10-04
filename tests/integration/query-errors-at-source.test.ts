import { inspect } from 'node:util';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { QueryError } from '@/lib/query-errors';
import { clinicsForUser } from '@/modules/auth';
import {
  insertClinic,
  migratorPool,
  pgErrorCode,
  PG,
  rawQueryError,
  withoutGrant,
} from './fixtures';

// E00-T03, D-070: no error leaves withTenant() or clinicsForUser() with the values its failed
// query was sent. Next.js prints an error that escapes a page, outside our logger, and from E01
// those values are patient names and phone numbers. Values here are synthetic markers.
const MARKER = 'MARKER-0d5a';

const admin = migratorPool();
let clinicId: string;

beforeAll(async () => {
  clinicId = await insertClinic(admin);
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** The error a promise rejects with. */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable('the query was meant to fail'),
    (error: unknown) => error,
  );
}

/** How Node prints an error: message, stack, own fields and the whole cause chain. */
const printed = (error: unknown) => inspect(error, { depth: 20 });

/** The PostgreSQL constraint name, wherever in the cause chain it is. */
function constraintOf(error: unknown): string | undefined {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
  }
  return undefined;
}

// Each query fails the same way for the app role inside withTenant and, for the guard, for the
// migration role outside it.
const failures = [
  {
    name: 'a check constraint violation',
    query: () =>
      sql`update clinics set name = ${MARKER}, currency = ${`${MARKER}-currency`}
          where id = ${clinicId}`,
    code: PG.checkViolation,
    constraint: 'clinics_currency_check',
  },
  {
    name: 'a unique violation (PostgreSQL quotes the key in its detail)',
    query: () => {
      const id = newId();
      return sql`insert into audit_log (id, clinic_id, at, actor_type, action, metadata)
                 select ${id}, ${clinicId}, now(), 'system', 'test.twice',
                        jsonb_build_object('note', ${MARKER}::text)
                 from generate_series(1, 2)`;
    },
    code: PG.uniqueViolation,
    constraint: 'audit_log_pkey',
  },
  {
    name: 'a value of the wrong type',
    query: () => sql`select id from clinics where id = ${MARKER}::uuid`,
    code: '22P02',
    constraint: undefined,
  },
  {
    name: 'invalid JSON (PostgreSQL quotes it in `where`)',
    query: () => sql`select ${`{"note": "${MARKER}`}::jsonb`,
    code: '22P02',
    constraint: undefined,
  },
];

describe('a failed query inside withTenant', () => {
  it.each(failures)('throws $name without the values sent', async ({ query, code, constraint }) => {
    // Guards the test: the same query, outside withTenant, fails with the marker in its error.
    expect(printed(await rawQueryError(admin, query()))).toContain(MARKER);

    const error = await errorOf(withTenant(clinicId, (tx) => tx.execute(query())));

    expect(printed(error)).not.toContain(MARKER);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as Error).message).toMatch(/^Failed query: /);
    expect(pgErrorCode(error)).toBe(code);
    expect(constraintOf(error)).toBe(constraint);
  });

  it('throws the same when the work wraps that error as the cause of its own', async () => {
    class SaveFailed extends Error {
      override name = 'SaveFailed';
      step = 'marking';
    }
    for (const wrap of [
      (cause: unknown) => new Error('could not save', { cause }),
      (cause: unknown) => new SaveFailed('could not save', { cause }),
      (cause: unknown) => new Error('outer', { cause: new Error('could not save', { cause }) }),
      (cause: unknown) => new AggregateError([cause], 'could not save'),
    ]) {
      const error = await errorOf(
        withTenant(clinicId, async (tx) => {
          try {
            await tx.execute(failures[0]!.query());
          } catch (failed) {
            throw wrap(failed);
          }
        }),
      );

      expect(printed(error)).not.toContain(MARKER);
      expect(printed(error)).toContain('could not save');
      expect(pgErrorCode((error as AggregateError).errors?.[0] ?? error)).toBe(PG.checkViolation);
      expect(constraintOf((error as AggregateError).errors?.[0] ?? error)).toBe(
        'clinics_currency_check',
      );
    }
  });

  it("keeps the work's own error class, so callers can still tell it apart", async () => {
    class SaveFailed extends Error {
      override name = 'SaveFailed';
    }
    const error = await errorOf(
      withTenant(clinicId, async (tx) => {
        await tx.execute(failures[0]!.query()).catch((failed: unknown) => {
          throw new SaveFailed('could not save', { cause: failed });
        });
      }),
    );
    expect(error).toBeInstanceOf(SaveFailed);
    expect((error as Error).name).toBe('SaveFailed');
  });

  it('lets an error without a failed query in it out as it is', async () => {
    const own = new Error('nothing to do with the database');
    expect(await errorOf(withTenant(clinicId, () => Promise.reject(own)))).toBe(own);
  });
});

describe('a failed query inside clinicsForUser', () => {
  it('throws without the user id it was sent, keeping the PostgreSQL code', async () => {
    const userId = newId(); // the value sent; a user id is enough to show where values go
    const error = await errorOf(
      withoutGrant(admin, 'execute', 'function clinics_for_user(uuid)', () =>
        clinicsForUser(userId),
      ),
    );

    expect(printed(error)).not.toContain(userId);
    expect(error).toBeInstanceOf(QueryError);
    expect((error as Error).message).toContain('clinics_for_user($1)');
    expect(pgErrorCode(error)).toBe(PG.insufficientPrivilege);
  });
});
