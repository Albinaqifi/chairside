import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '@/app/_lib/actions';
import type { PatientList } from '@/modules/patients';
import { sendSearch } from './search-answer';

// E01-T02a: each answer of the patients' read, as the list shows it. The read is a stand-in that
// answers as told; the real one is checked in tests/integration/patients-list.test.ts and
// src/app/action-permissions.test.ts.

const CLINIC = '01970000-0000-7000-8000-0000000000a1';
const LIST: PatientList = { total: 0, rows: [], more: false };

function answering(result: ActionResult<PatientList>) {
  return vi.fn(() => Promise.resolve(result));
}

describe('sendSearch', () => {
  it("sends what was typed, as the read's input, with the clinic id given", async () => {
    const read = answering({ ok: true, value: LIST });
    expect(await sendSearch(read, CLINIC, 'Ana')).toEqual({ kind: 'found', list: LIST });
    expect(read).toHaveBeenCalledWith(CLINIC, { text: 'Ana' });
  });

  it('clinic_changed: the list asks for a reload', async () => {
    const read = answering({ ok: false, error: { code: 'clinic_changed' } });
    expect(await sendSearch(read, CLINIC, 'Ana')).toEqual({ kind: 'clinic_changed' });
  });

  it.each([
    { code: 'internal' as const },
    { code: 'forbidden' as const },
    { code: 'invalid_input' as const, issues: [{ path: ['text'], code: 'too_big' }] },
  ])('$code: the general failure', async (error) => {
    expect(await sendSearch(answering({ ok: false, error }), CLINIC, 'Ana')).toEqual({
      kind: 'failed',
    });
  });

  it('a call that never got an answer: the general failure, not an error', async () => {
    const read = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await sendSearch(read, CLINIC, 'Ana')).toEqual({ kind: 'failed' });
  });

  it("Next.js's redirect after an ended session goes on, for Next.js to carry out", async () => {
    const toLogin = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    await expect(
      sendSearch(
        vi.fn(() => Promise.reject(toLogin)),
        CLINIC,
        'Ana',
      ),
    ).rejects.toBe(toLogin);
  });
});
