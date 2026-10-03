import pino, {
  type Bindings,
  type DestinationStream,
  type LogFn,
  type Logger,
  type LoggerOptions,
} from 'pino';
import { isPersonalField } from './personal-fields';

/**
 * Structured JSON logs. Log ids and codes, never personal data (security-privacy.md, section 6).
 *
 * As a safety net, every field listed in personal-fields.ts is dropped before a line is
 * written, at any depth: in the logged object, in printf-style arguments (`%s`, `%o`, `%O`,
 * `%j`), in child-logger bindings, and inside errors (including their causes). The values a
 * failed database query was sent are removed from error messages and stacks too. pino's own
 * `redact` option is not used because it only matches fixed paths.
 *
 * Text cannot be cleaned: pass errors and values as fields or arguments, never inside the message.
 */
export function createLogger(destination?: DestinationStream): Logger {
  const cleanBindings = (bindings: Bindings) => clean(bindings) as Bindings;
  const options: LoggerOptions = {
    hooks: {
      // pino copies an error's message into `msg`, and formats printf-style arguments into it,
      // before any formatter runs. Cleaning every argument here, first, means pino only ever sees
      // cleaned values.
      logMethod(args, method) {
        const [first, ...rest] = args as unknown[];
        const object = first instanceof Error ? { err: first } : first;
        const cleaned = object !== null && typeof object === 'object' ? clean(object) : object;
        method.apply(this, [cleaned, ...rest.map(cleanArgument)] as Parameters<LogFn>);
      },
    },
    formatters: {
      bindings: cleanBindings,
      // A second pass over the object logMethod already cleaned, for anything added after it.
      log: (object: Record<string, unknown>) => clean(object) as Record<string, unknown>,
    },
    // Errors arrive as clean plain objects. pino's default `err` serializer would convert them a
    // second time and lose the error type.
    serializers: { err: (value: unknown) => value },
  };
  const logger = destination ? pino(options, destination) : pino(options);

  // pino gives every child logger a bindings formatter that does nothing, unless one is passed
  // when the child is created. Pass ours to every child (and so to grandchildren).
  const pinoChild = logger.child;
  logger.child = function child(this: Logger, bindings: Bindings, childOptions = {}) {
    return pinoChild.call(this, bindings, {
      ...childOptions,
      formatters: { ...childOptions.formatters, bindings: cleanBindings },
    });
  } as Logger['child'];

  return logger;
}

export const logger = createLogger();

/**
 * A message or printf-style argument without personal fields and query values. pino writes `%s`
 * with String() and `%o`, `%O` and `%j` with JSON.stringify, so an object or an error becomes its
 * cleaned copy; a cleaned error still reads as "Type: message" through `%s`. Text and numbers are
 * written as they are.
 */
function cleanArgument(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const cleaned = clean(value);
  if (value instanceof Error && cleaned !== null && typeof cleaned === 'object') {
    const { type, message } = cleaned as { type?: unknown; message?: unknown };
    const text = [type, message].filter((part) => part !== undefined && part !== '').join(': ');
    // Not enumerable, so JSON.stringify (`%j`) leaves it out.
    Object.defineProperty(cleaned, 'toString', { value: () => text });
  }
  return cleaned;
}

/** Copies a value without personal fields. Errors become plain objects. */
function clean(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return '[Circular]';

  ancestors.add(value);
  try {
    if (value instanceof Error) return clean(errorToObject(value), ancestors);
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') return clean(toJSON.call(value), ancestors);
    if (Array.isArray(value)) return value.map((item) => clean(item, ancestors));

    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (!isPersonalField(key)) copy[key] = clean(item, ancestors);
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}

function errorToObject(error: Error): Record<string, unknown> {
  const message = messageWithoutValues(error);
  const result: Record<string, unknown> = {
    type: error.name,
    message,
    stack: message === error.message ? error.stack : restack(error, message),
  };
  for (const [key, item] of Object.entries(error)) {
    if (!(key in result)) result[key] = item;
  }
  if (error.cause !== undefined) result.cause = error.cause;
  return result;
}

/**
 * PostgreSQL errors whose message quotes the value a query was sent: data errors (SQLSTATE class
 * 22), and syntax errors (42601), which is how the full-text search parsers report text they
 * cannot read. A syntax error in the SQL itself loses its quoted token too; the SQL, with `$1`
 * placeholders, and the error's `position` stay.
 */
const VALUE_QUOTING_CODE = /^(22[0-9A-Z]{3}|42601)$/;

/**
 * The error's message without the values a failed database query was sent. Drizzle adds them to
 * its own message (`Failed query: … params: …`) and keeps them in `params`, which is dropped as a
 * personal field. PostgreSQL quotes the offending value in some messages, for example
 * `invalid input syntax for type uuid: "…"` or `syntax error in tsquery: "…"`.
 */
function messageWithoutValues(error: Error): string {
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
function restack(error: Error, message: string): string | undefined {
  const { stack } = error;
  if (stack === undefined || !stack.includes(error.message)) return undefined;
  // A function, so `$&` and similar in the message are not read as replacement patterns.
  return stack.replace(error.message, () => message);
}
