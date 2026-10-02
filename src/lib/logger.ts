import pino, { type Bindings, type DestinationStream, type Logger } from 'pino';
import { isPersonalField } from './personal-fields';

/**
 * Structured JSON logs. Log ids and codes, never personal data (security-privacy.md, section 6).
 *
 * As a safety net, every field listed in personal-fields.ts is dropped before a line is
 * written, at any depth: in the logged object, in child-logger bindings, and inside errors
 * (including their causes). pino's own `redact` option is not used because it only matches
 * fixed paths.
 */
export function createLogger(destination?: DestinationStream): Logger {
  const cleanBindings = (bindings: Bindings) => clean(bindings) as Bindings;
  const options = {
    formatters: {
      bindings: cleanBindings,
      log: (object: Record<string, unknown>) => clean(object) as Record<string, unknown>,
    },
    // The formatters above already turned errors into clean plain objects. pino's default
    // `err` serializer would convert them a second time and lose the error type.
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
  const result: Record<string, unknown> = {
    type: error.name,
    message: error.message,
    stack: error.stack,
  };
  for (const [key, item] of Object.entries(error)) {
    if (!(key in result)) result[key] = item;
  }
  if (error.cause !== undefined) result.cause = error.cause;
  return result;
}
