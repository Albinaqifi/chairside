import { inspect } from 'node:util';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { QueryError, withoutQueryValues } from './query-errors';

// Every personal value in these tests is a marker. A marker in the output means a leak.
const MARKER = 'MARKER-q41e';
const SQL = 'insert into "users" ("id", "email") values ($1, $2)';

/** A failed insert as Drizzle and pg report it: the values in the message, params and detail. */
function failedInsert() {
  const cause = Object.assign(
    new Error('duplicate key value violates unique constraint "users_email_unique"'),
    {
      code: '23505',
      severity: 'ERROR',
      schema: 'public',
      table: 'users',
      constraint: 'users_email_unique',
      detail: `Key (email)=(${MARKER}@example.test) already exists.`,
      where: `SQL statement with ${MARKER}`,
    },
  );
  return new DrizzleQueryError(SQL, ['user-1', `${MARKER}@example.test`], cause);
}

describe('withoutQueryValues', () => {
  it('copies a failed query without its values, in the message, stack, params and cause', () => {
    const original = failedInsert();
    const copy = withoutQueryValues(original);

    expect(inspect(original)).toContain(MARKER); // the test sees the leak it guards against
    expect(inspect(copy)).not.toContain(MARKER);
    expect(copy).toBeInstanceOf(QueryError);
    expect(copy).toMatchObject({ name: 'QueryError', message: `Failed query: ${SQL}` });
    expect((copy as Error).stack).toContain('query-errors.test.ts');
    expect((copy as Error).cause).toMatchObject({
      message: 'duplicate key value violates unique constraint "users_email_unique"',
      code: '23505',
      severity: 'ERROR',
      schema: 'public',
      table: 'users',
      constraint: 'users_email_unique',
    });
    expect((copy as Error).cause).not.toHaveProperty('detail');
    expect((copy as Error).cause).not.toHaveProperty('where');
    expect(copy).not.toHaveProperty('params');
  });

  it('drops the value PostgreSQL quotes in a data error', () => {
    const error = Object.assign(new Error(`invalid input syntax for type uuid: "${MARKER}"`), {
      code: '22P02',
    });
    const copy = withoutQueryValues(error);

    expect(inspect(copy)).not.toContain(MARKER);
    expect(copy).toMatchObject({
      message: 'invalid input syntax for type uuid: "…"',
      code: '22P02',
    });
  });

  it('returns anything that is not a database error as it is', () => {
    const notFromAQuery = [
      new TypeError('not a query'),
      Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
      'text',
      undefined,
    ];
    for (const value of notFromAQuery) expect(withoutQueryValues(value)).toBe(value);
  });

  it('keeps a cause that does not come from a query', () => {
    const cause = new Error('Connection terminated unexpectedly');
    const copy = withoutQueryValues(new DrizzleQueryError(SQL, ['user-1', MARKER], cause));

    expect(inspect(copy)).not.toContain(MARKER);
    expect((copy as Error).cause).toBe(cause);
  });
});
