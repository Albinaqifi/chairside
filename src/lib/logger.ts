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
 * written, at any depth: in the logged object, in child-logger bindings, and inside errors
 * (including their causes). The values a failed database query was sent are removed from error
 * messages and stacks too. pino's own `redact` option is not used because it only matches fixed
 * paths.
 */
export function createLogger(destination?: DestinationStream): Logger {
  const cleanBindings = (bindings: Bindings) => clean(bindings) as Bindings;
  const options: LoggerOptions = {
    hooks: {
      // pino copies an error's message into `msg` before any formatter runs. Cleaning the logged
      // object here, first, means pino only ever sees the cleaned message.
      logMethod(args, method) {
        const [first, ...rest] = args as unknown[];
        const object = first instanceof Error ? { err: first } : first;
        const cleaned = object !== null && typeof object === 'object' ? clean(object) : object;
        method.apply(this, [cleaned, ...rest] as Parameters<LogFn>);
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

/** A PostgreSQL data error, such as invalid input syntax (SQLSTATE class 22). */
const DATA_ERROR_CODE = /^22[0-9A-Z]{3}$/;

/**
 * The error's message without the values a failed database query was sent. Drizzle adds them to
 * its own message (`Failed query: … params: …`) and keeps them in `params`, which is dropped as a
 * personal field. PostgreSQL quotes the offending value in the message of a data error, for
 * example `invalid input syntax for type uuid: "…"`.
 */
function messageWithoutValues(error: Error): string {
  const { query, params, code } = error as Error & {
    query?: unknown;
    params?: unknown;
    code?: unknown;
  };
  if (typeof query === 'string' && Array.isArray(params)) return `Failed query: ${query}`;
  if (typeof code === 'string' && DATA_ERROR_CODE.test(code)) {
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
