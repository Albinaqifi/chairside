import { redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import type { InputIssue } from './action-input';
import type { ActionResult, StaffAction } from './actions';
import { answerOf, fieldProblems, sendForm } from './form-answer';

// E00-T04c, acceptance 5: what a staff form shows for each wrapper code, for a refusal and for a
// call that rejects. Every value is synthetic.

const CLINIC = '01970000-0000-7000-8000-00000000c0c1';

/** A form's data from name–value pairs. */
function formData(fields: Record<string, string | string[]> = {}): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  }
  return data;
}

/** A stand-in for a wrapper-made action that answers `result`, and records what it was sent. */
function answering(result: ActionResult<{ id: string }, 'not_found'>) {
  return vi.fn<StaffAction<unknown, { id: string }, 'not_found'>>(() => Promise.resolve(result));
}

describe('sendForm: a staff form sent to a wrapper-made action', () => {
  it('sends the clinic id it is given and the form data as it is, once', async () => {
    const action = answering({ ok: true, value: { id: 'x' } });
    const data = formData({ note: 'a note' });
    await sendForm(action, CLINIC, data);
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(CLINIC, data);
  });

  it('done: the answer carries the value', async () => {
    const answer = await sendForm(answering({ ok: true, value: { id: 'x' } }), CLINIC, formData());
    expect(answer).toEqual({ kind: 'done', value: { id: 'x' } });
  });

  it.each([
    { code: 'forbidden', kind: 'forbidden' },
    { code: 'clinic_changed', kind: 'clinic_changed' },
    { code: 'internal', kind: 'failed' },
  ] as const)('$code → $kind', async ({ code, kind }) => {
    const answer = await sendForm(answering({ ok: false, error: { code } }), CLINIC, formData());
    expect(answer).toEqual({ kind });
  });

  it('invalid_input → invalid, with each problem at its field', async () => {
    const issues: InputIssue[] = [{ path: ['code'], code: 'invalid_format' }];
    const answer = await sendForm(
      answering({ ok: false, error: { code: 'invalid_input', issues } }),
      CLINIC,
      formData({ code: '12' }),
    );
    expect(answer).toEqual({ kind: 'invalid', fields: new Map([['code', 'invalidFormat']]) });
  });

  it("a handler's own refusal → refused, with its code", async () => {
    const answer = await sendForm(
      answering({ ok: false, error: { code: 'not_found' } }),
      CLINIC,
      formData(),
    );
    expect(answer).toEqual({ kind: 'refused', code: 'not_found' });
  });

  it.each<{ name: string; reason: unknown }>([
    { name: 'a network failure', reason: new TypeError('Failed to fetch') },
    { name: 'an error of any kind', reason: new Error('connection reset') },
    { name: 'a rejection that is not an Error', reason: 'offline' },
  ])(
    'a call that rejects ($name) → failed: the general failure, never an error screen',
    async ({ reason }) => {
      const action = vi.fn<StaffAction<unknown, never>>(() => Promise.reject(reason));
      expect(await sendForm(action, CLINIC, formData())).toEqual({ kind: 'failed' });
    },
  );

  it("rethrows Next.js's redirect (an ended session), which its router carries out", async () => {
    let redirectError: unknown;
    try {
      redirect('/login');
    } catch (error) {
      redirectError = error;
    }
    const action = vi.fn<StaffAction<unknown, never>>(() => Promise.reject(redirectError));
    await expect(sendForm(action, CLINIC, formData())).rejects.toBe(redirectError);
  });
});

describe('answerOf: an answer the wrappers do not give', () => {
  it('invalid_input without its issues is the general failure, not a refusal', () => {
    const result = { ok: false, error: { code: 'invalid_input' } } as ActionResult<never, string>;
    expect(answerOf(result, formData())).toEqual({ kind: 'failed' });
  });
});

describe('fieldProblems: where each input issue shows, and as what', () => {
  it.each([
    { code: 'too_small', problem: 'tooSmall' },
    { code: 'too_big', problem: 'tooBig' },
    { code: 'invalid_format', problem: 'invalidFormat' },
    { code: 'invalid_type', problem: 'other' },
    { code: 'invalid_value', problem: 'other' },
    { code: 'custom', problem: 'other' },
    { code: 'toString', problem: 'other' },
  ])('$code on a field sent with a value → $problem', ({ code, problem }) => {
    const problems = fieldProblems([{ path: ['note'], code }], formData({ note: 'x' }));
    expect(problems).toEqual(new Map([['note', problem]]));
  });

  it.each([
    { name: 'sent empty', data: formData({ note: '' }) },
    { name: 'sent as blanks', data: formData({ note: '   ' }) },
    { name: 'not sent', data: formData() },
    { name: 'sent empty twice', data: formData({ note: ['', ' '] }) },
  ])('a field $name is missing, whatever the code', ({ data }) => {
    for (const code of ['too_small', 'invalid_type', 'invalid_format']) {
      expect(fieldProblems([{ path: ['note'], code }], data).get('note')).toBe('missing');
    }
  });

  it('an empty file input is missing; a file is not', () => {
    const empty = new FormData();
    empty.append('upload', new File([], ''));
    const sent = new FormData();
    sent.append('upload', new File(['x'], 'list.csv'));
    const issue = [{ path: ['upload'], code: 'custom' }];
    expect(fieldProblems(issue, empty).get('upload')).toBe('missing');
    expect(fieldProblems(issue, sent).get('upload')).toBe('other');
  });

  it('keeps the first issue of each field', () => {
    const problems = fieldProblems(
      [
        { path: ['note'], code: 'too_big' },
        { path: ['note'], code: 'invalid_format' },
        { path: ['code'], code: 'invalid_format' },
      ],
      formData({ note: 'x', code: 'y' }),
    );
    expect(problems).toEqual(
      new Map([
        ['note', 'tooBig'],
        ['code', 'invalidFormat'],
      ]),
    );
  });

  it('shows a nested issue at the field its path starts with', () => {
    const problems = fieldProblems(
      [{ path: ['items', 0, 'quantity'], code: 'too_small' }],
      formData({ items: 'x' }),
    );
    expect(problems).toEqual(new Map([['items', 'tooSmall']]));
  });

  it('gives no field to an issue of the whole input, a list position or a key the schema does not declare', () => {
    const problems = fieldProblems(
      [
        { path: [], code: 'custom' },
        { path: [0], code: 'invalid_type' },
        { path: ['*'], code: 'invalid_key' },
      ],
      formData(),
    );
    expect(problems.size).toBe(0);
  });

  it('reads a field named like an object property as any other', () => {
    const problems = fieldProblems(
      [{ path: ['constructor'], code: 'too_big' }],
      formData({ constructor: 'x' }),
    );
    expect(problems.get('constructor')).toBe('tooBig');
    expect(problems.get('toString')).toBeUndefined();
  });
});
