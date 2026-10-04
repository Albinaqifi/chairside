import { inspect, types } from 'node:util';
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

  it('returns an error whose causes hold no failed query as it is', () => {
    const error = new Error('outer', { cause: new TypeError('inner', { cause: 'text' }) });
    expect(withoutQueryValues(error)).toBe(error);
  });
});

// E00-T03 (D-070): a failed query deeper inside another error, for example an action that keeps
// it as the `cause` of its own error, must not print its values either.
describe('withoutQueryValues, for an error that holds a failed query', () => {
  class BookingError extends Error {
    override name = 'BookingError';
    step = 'insert';
  }

  it('copies it with its class, message, stack and fields, and the failed query cleaned', () => {
    const original = new BookingError('could not book', { cause: failedInsert() });
    const copy = withoutQueryValues(original) as BookingError;

    expect(inspect(original)).toContain(MARKER); // the test sees the leak it guards against
    expect(inspect(copy)).not.toContain(MARKER);
    expect(copy).not.toBe(original);
    expect(copy).toBeInstanceOf(BookingError);
    expect(types.isNativeError(copy)).toBe(true);
    expect(copy).toMatchObject({ name: 'BookingError', message: 'could not book', step: 'insert' });
    expect(copy.stack).toBe(original.stack);
    expect(Object.keys(copy)).toEqual(Object.keys(original));
    expect(copy.cause).toBeInstanceOf(QueryError);
    expect((copy.cause as Error).cause).toMatchObject({
      code: '23505',
      constraint: 'users_email_unique',
    });
  });

  it('finds it at any depth of the cause chain', () => {
    const original = new Error('outer', {
      cause: new Error('middle', { cause: new Error('inner', { cause: failedInsert() }) }),
    });
    const copy = withoutQueryValues(original) as Error;

    expect(inspect(original, { depth: 10 })).toContain(MARKER);
    expect(inspect(copy, { depth: 10 })).not.toContain(MARKER);
    const middle = copy.cause as Error;
    const inner = middle.cause as Error;
    expect([copy.message, middle.message, inner.message]).toEqual(['outer', 'middle', 'inner']);
    expect(inner.cause).toBeInstanceOf(QueryError);
  });

  it('finds it among the errors of an AggregateError and in other own properties', () => {
    const fine = new Error('fine');
    const aggregate = new AggregateError([fine, failedInsert()], 'all failed');
    const holder = Object.assign(new Error('holder'), { original: failedInsert() });

    for (const original of [aggregate, holder]) {
      expect(inspect(original, { depth: 10 })).toContain(MARKER);
      const copy = withoutQueryValues(original);
      expect(inspect(copy, { depth: 10 })).not.toContain(MARKER);
      expect(copy).toBeInstanceOf(original.constructor);
    }
    const copied = withoutQueryValues(aggregate) as AggregateError;
    expect(copied.errors[0], 'an error without a query stays as it is').toBe(fine);
    expect(copied.errors[1]).toBeInstanceOf(QueryError);
  });

  it('copies an error that holds itself once, and stops', () => {
    const outer = new Error('outer');
    const inner = new Error('inner', { cause: outer });
    Object.assign(outer, { inner, failed: failedInsert() }); // outer → inner → outer: a loop

    const copy = withoutQueryValues(outer) as Error & { inner: Error; failed: Error };

    expect(inspect(copy, { depth: 10 })).not.toContain(MARKER);
    expect(copy.inner.cause, 'the loop now runs between the copies').toBe(copy);
    expect(copy.failed).toBeInstanceOf(QueryError);
  });
});
