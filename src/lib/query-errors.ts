/**
 * Errors from database queries, without the values the queries were sent (security-privacy.md,
 * section 6). Drizzle writes a failed query's values into its error's message and keeps them in
 * `params`; PostgreSQL quotes them in some messages and in `detail` and `where`.
 *
 * The logger cleans every error it writes. `withoutQueryValues` is for errors that something
 * other than our logger prints: a library that writes unexpected errors to the console itself,
 * or a framework that prints an error that escapes. It is applied where errors are made: the auth
 * library's adapter (D-066), withTenant() and clinicsForUser() (D-070).
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
 *
 * Another error is returned as it is, unless a query error sits inside it, at any depth: in its
 * cause, in an AggregateError's `errors`, or in another of its own properties. Then the result is
 * a copy of it (D-070): the same class, message, stack and fields, with every inner error copied
 * the same way. So an action that wraps a failed query as the `cause` of its own error keeps its
 * error, and loses only the values. Any value that is not an error is returned as it is.
 */
export function withoutQueryValues(error: unknown): unknown {
  return safeCopy(error, new Map());
}

/** The copies made so far in one call, by original: an error that holds itself is copied once. */
type Copies = Map<Error, Error>;

function safeCopy(value: unknown, copies: Copies): unknown {
  if (!(value instanceof Error)) return value;
  const copied = copies.get(value);
  if (copied) return copied;
  if (isQueryError(value)) return copyQueryError(value, copies);
  if (!holdsQueryError(value, new Set())) return value;
  return copyHolder(value, copies);
}

function copyQueryError(error: Error, copies: Copies): QueryError {
  const message = messageWithoutValues(error);
  const copy = new QueryError(message);
  copies.set(error, copy);
  const cause = safeCopy(error.cause, copies);
  // As `new Error(message, { cause })` would define it: not enumerable.
  if (cause !== undefined) setOwn(copy, 'cause', cause);
  const fields = error as unknown as Record<string, unknown>;
  for (const field of NAMING_FIELDS) {
    const value = fields[field];
    if (typeof value === 'string') copy[field] = value;
  }
  copy.stack = restack(error, message) ?? copy.stack;
  return copy;
}

/**
 * A copy of an error that is not a query error but holds one. It is a real error object with the
 * original's prototype, so `instanceof` still holds and printers show it as the same error.
 */
function copyHolder(error: Error, copies: Copies): Error {
  const copy = Object.setPrototypeOf(new Error(), Object.getPrototypeOf(error) as object) as Error;
  copies.set(error, copy);
  for (const [key, descriptor] of ownProperties(error)) {
    if (key === 'stack') {
      // An accessor on the original that reads the original's internal state: copy its text.
      setOwn(copy, 'stack', error.stack);
    } else if ('value' in descriptor) {
      Object.defineProperty(copy, key, {
        ...descriptor,
        value: copyInner(descriptor.value, copies),
      });
    } else {
      Object.defineProperty(copy, key, descriptor);
    }
  }
  // A cause the class defines on its prototype would still print the original: shadow it.
  if (!Object.hasOwn(error, 'cause') && 'cause' in error) {
    setOwn(copy, 'cause', safeCopy(error.cause, copies));
  }
  return copy;
}

/** A property value with every error in it copied safely: an error, or a list such as `errors`. */
function copyInner(value: unknown, copies: Copies): unknown {
  if (Array.isArray(value) && value.some((item) => item instanceof Error)) {
    return value.map((item: unknown) => safeCopy(item, copies));
  }
  return safeCopy(value, copies);
}

/** True if a query error is held anywhere inside `error`. `visited` stops at a loop. */
function holdsQueryError(error: Error, visited: Set<Error>): boolean {
  if (visited.has(error)) return false;
  visited.add(error);
  return innerErrors(error).some((inner) => isQueryError(inner) || holdsQueryError(inner, visited));
}

/** The errors an error holds: its cause, and those in its own properties (getters are not read). */
function innerErrors(error: Error): Error[] {
  const values: unknown[] = 'cause' in error ? [error.cause] : [];
  for (const [key, descriptor] of ownProperties(error)) {
    if (key === 'stack' || !('value' in descriptor)) continue;
    const value: unknown = descriptor.value;
    if (Array.isArray(value)) values.push(...(value as unknown[]));
    else values.push(value);
  }
  return values.filter((value): value is Error => value instanceof Error);
}

/** Every own property of an object, symbol keys included, with its descriptor. */
function ownProperties(target: object): [PropertyKey, PropertyDescriptor][] {
  const descriptors: Record<PropertyKey, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(target);
  return Reflect.ownKeys(descriptors).map((key) => [key, descriptors[key]!]);
}

/** Defines an own property the way JavaScript defines `cause` and `stack`: not enumerable. */
function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
