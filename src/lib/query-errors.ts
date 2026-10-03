/**
 * Errors from database queries, without the values the queries were sent (security-privacy.md,
 * section 6). Drizzle writes a failed query's values into its error's message and keeps them in
 * `params`; PostgreSQL quotes them in some messages and in `detail` and `where`.
 *
 * The logger cleans every error it writes. `withoutQueryValues` is for errors that something
 * other than our logger prints: a library that writes unexpected errors to the console itself,
 * or a framework that prints an error that escapes.
 */

/**
 * PostgreSQL errors whose message quotes the value a query was sent: data errors (SQLSTATE class
 * 22), and syntax errors (42601), which is how the full-text search parsers report text they
 * cannot read. A syntax error in the SQL itself loses its quoted token too; the SQL, with `$1`
 * placeholders, and the error's `position` stay.
 */
const VALUE_QUOTING_CODE = /^(22[0-9A-Z]{3}|42601)$/;

/** A PostgreSQL error code (SQLSTATE): five digits or capital letters. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/** The fields of a PostgreSQL error that name things (tables, columns, constraints), never values. */
const NAMING_FIELDS = ['code', 'severity', 'schema', 'table', 'column', 'constraint'] as const;

/**
 * The error's message without the values a failed database query was sent. Drizzle adds them to
 * its own message (`Failed query: … params: …`) and keeps them in `params`. PostgreSQL quotes
 * the offending value in some messages, for example `invalid input syntax for type uuid: "…"` or
 * `syntax error in tsquery: "…"`.
 */
export function messageWithoutValues(error: Error): string {
  const { query, params, code } = error as Error & {
    query?: unknown;
    params?: unknown;
    code?: unknown;
  };
  if (typeof query === 'string' && Array.isArray(params)) return `Failed query: ${query}`;
  if (typeof code === 'string' && VALUE_QUOTING_CODE.test(code)) {
    // From the first quote to the last, so a value that contains quotes is removed whole.
    return error.message.replace(/"[\s\S]*"/, '"…"');
  }
  return error.message;
}

/**
 * The stack with the cleaned message in place of the original one, which it starts with. A stack
 * that does not contain the original message (it was changed later) is dropped: where the values
 * are in it is unknown.
 */
export function restack(error: Error, message: string): string | undefined {
  const { stack } = error;
  if (stack === undefined || !stack.includes(error.message)) return undefined;
  // A function, so `$&` and similar in the message are not read as replacement patterns.
  return stack.replace(error.message, () => message);
}

/** A failed database query, as `withoutQueryValues` returns it. */
export class QueryError extends Error {
  override name = 'QueryError';
  // Declared only, so a field the database did not give is absent rather than undefined.
  /** The PostgreSQL error code (SQLSTATE), when the database gave one. */
  declare code?: string;
  declare severity?: string;
  declare schema?: string;
  declare table?: string;
  declare column?: string;
  declare constraint?: string;
}

/** True for Drizzle's error around a failed query, and for an error from PostgreSQL itself. */
function isQueryError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const { query, params, code } = error as Error & {
    query?: unknown;
    params?: unknown;
    code?: unknown;
  };
  return (
    (typeof query === 'string' && Array.isArray(params)) ||
    (typeof code === 'string' && SQLSTATE.test(code))
  );
}

/**
 * A copy of a database error that is safe to print: the message without the values, the stack
 * with that message, the names PostgreSQL gives (code, table, column, constraint), and the cause
 * copied the same way. Everything else (`params`, `detail`, `where`, `hint`…) is left out.
 * Any other value, including an error that does not come from a query, is returned as it is.
 */
export function withoutQueryValues(error: unknown): unknown {
  if (!isQueryError(error)) return error;
  const message = messageWithoutValues(error);
  const cause = withoutQueryValues(error.cause);
  const copy = new QueryError(message, cause === undefined ? undefined : { cause });
  const fields = error as unknown as Record<string, unknown>;
  for (const field of NAMING_FIELDS) {
    const value = fields[field];
    if (typeof value === 'string') copy[field] = value;
  }
  copy.stack = restack(error, message) ?? copy.stack;
  return copy;
}
