import { z } from 'zod';

/**
 * Step 4 of the action wrappers (./actions.ts): the input, parsed with Zod (D-068). A refusal says
 * where and what kind of problem, never what was sent (security-privacy.md, section 6).
 */

/** One problem with the input. */
export interface InputIssue {
  /**
   * Where: the field names the schema declares and positions in lists, for example
   * `['items', 0, 'quantity']`. Any other key, such as a key of a record, is something the
   * browser sent, so it is shown as `*`.
   */
  path: (string | number)[];
  /** Zod's code for the problem: `invalid_type`, `too_small`, `invalid_format`… */
  code: string;
}

export type ParsedInput<T> = { ok: true; value: T } | { ok: false; issues: InputIssue[] };

/**
 * Parses what an action was sent: a plain value from a component, or the FormData of a form
 * (each field becomes a property: one value as it is, several as a list).
 */
export async function parseInput<S extends z.ZodType>(
  schema: S,
  sent: unknown,
): Promise<ParsedInput<z.output<S>>> {
  const result = await schema.safeParseAsync(sent instanceof FormData ? formFields(sent) : sent);
  if (result.success) return { ok: true, value: result.data };
  const declared = declaredFields(schema);
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map((key) => pathKey(key, declared)),
      code: issue.code,
    })),
  };
}

function formFields(formData: FormData): Record<string, unknown> {
  const names = [...new Set(formData.keys())];
  // fromEntries defines each name as an own property, also `__proto__`.
  return Object.fromEntries(
    names.map((name) => {
      const values = formData.getAll(name);
      return [name, values.length === 1 ? values[0] : values];
    }),
  );
}

function pathKey(key: PropertyKey, declared: ReadonlySet<string>): string | number {
  if (typeof key === 'number' && Number.isSafeInteger(key) && key >= 0) return key;
  if (typeof key === 'string' && declared.has(key)) return key;
  return '*';
}

const declaredBySchema = new WeakMap<z.ZodType, ReadonlySet<string>>();

/**
 * Every field name the schema declares, at any depth: the keys of its objects. Read from the
 * schema's JSON Schema, where an object's fields are its `properties`; a record's keys are not
 * declared there. If the schema cannot be described, no name is known and every key shows as `*`.
 */
function declaredFields(schema: z.ZodType): ReadonlySet<string> {
  let names = declaredBySchema.get(schema);
  if (!names) {
    const found = new Set<string>();
    try {
      collectProperties(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), found);
    } catch {
      found.clear();
    }
    names = found;
    declaredBySchema.set(schema, names);
  }
  return names;
}

function collectProperties(node: unknown, names: Set<string>): void {
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && typeof value === 'object' && value !== null) {
      for (const name of Object.keys(value)) names.add(name);
    }
    collectProperties(value, names);
  }
}
