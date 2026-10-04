import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { parseInput } from './action-input';

// Values are synthetic. A marker in the issues would mean the answer repeats what was sent.
const MARKER = 'MARKER-6c2f';

describe('parseInput', () => {
  it('parses a plain value, applying the schema (unknown keys dropped)', async () => {
    const schema = z.object({ name: z.string().trim(), count: z.coerce.number() });
    expect(await parseInput(schema, { name: ' Ana ', count: '3', other: MARKER })).toEqual({
      ok: true,
      value: { name: 'Ana', count: 3 },
    });
  });

  it("parses a form's fields: one value as it is, several as a list", async () => {
    const schema = z.object({ clinicId: z.uuid(), tags: z.array(z.string()) });
    const clinicId = newId();
    const form = new FormData();
    form.append('clinicId', clinicId);
    form.append('tags', 'a');
    form.append('tags', 'b');
    form.append('__proto__', MARKER);

    const parsed = await parseInput(schema, form);

    expect(parsed).toEqual({ ok: true, value: { clinicId, tags: ['a', 'b'] } });
    expect(({} as Record<string, unknown>)[MARKER]).toBeUndefined(); // no prototype was touched
  });

  it('refuses with paths and codes only, never a value that was sent', async () => {
    const schema = z.object({
      clinicId: z.uuid(),
      name: z.string().max(5),
      items: z.array(z.object({ quantity: z.number().int() })),
      tags: z.record(z.uuid(), z.string()),
      extra: z.looseObject({}).catchall(z.number()),
      strict: z.strictObject({ a: z.string() }),
      kind: z.enum(['first', 'second']),
      either: z.union([z.number(), z.boolean()]),
    });
    const sent = {
      clinicId: MARKER,
      name: `${MARKER}-too-long`,
      items: [{ quantity: 1 }, { quantity: MARKER }],
      tags: { [MARKER]: 'a value', [newId()]: 5 },
      extra: { [`${MARKER}-key`]: MARKER },
      strict: { a: 'fine', [`${MARKER}-unknown`]: 1 },
      kind: MARKER,
      either: MARKER,
    };

    const parsed = await parseInput(schema, sent);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(JSON.stringify(parsed)).not.toContain('MARKER');
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        { path: ['clinicId'], code: 'invalid_format' },
        { path: ['name'], code: 'too_big' },
        { path: ['items', 1, 'quantity'], code: 'invalid_type' },
        { path: ['tags', '*'], code: 'invalid_key' },
        { path: ['tags', '*'], code: 'invalid_type' },
        { path: ['extra', '*'], code: 'invalid_type' },
        { path: ['strict'], code: 'unrecognized_keys' },
        { path: ['kind'], code: 'invalid_value' },
        { path: ['either'], code: 'invalid_union' },
      ]),
    );
    for (const issue of parsed.issues) expect(Object.keys(issue).sort()).toEqual(['code', 'path']);
  });

  it('refuses a value that is not the expected shape at all', async () => {
    const parsed = await parseInput(z.object({ clinicId: z.uuid() }), MARKER);
    expect(parsed).toEqual({ ok: false, issues: [{ path: [], code: 'invalid_type' }] });
  });

  // Added by the tester (E00-T03): two more places a key that was sent can reach a path.
  it('shows a sent key as * inside a union branch, and in a path a custom issue builds', async () => {
    const inBranch = await parseInput(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('counts'), counts: z.record(z.string(), z.number()) }),
      ]),
      { kind: 'counts', counts: { [MARKER]: MARKER } },
    );
    const custom = await parseInput(
      z.object({ note: z.string() }).superRefine((value, ctx) => {
        // A schema whose author built the path from a value that was sent.
        ctx.addIssue({ code: 'custom', path: ['note', value.note], message: value.note });
      }),
      { note: MARKER },
    );

    expect(inBranch).toEqual({
      ok: false,
      issues: [{ path: ['counts', '*'], code: 'invalid_type' }],
    });
    expect(custom).toEqual({ ok: false, issues: [{ path: ['note', '*'], code: 'custom' }] });
  });
});
