import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '@/app/_lib/actions';
import type { LikelyDuplicate } from '@/modules/patients';
import { sendCheck, typedOf, type TypedFields } from './duplicate-answer';

// E01-T02b: the new-patient form's check for a patient already in the list, as the form reads and
// shows it. The check is a stand-in that answers as told; the real one is checked in
// tests/integration/patients-create.test.ts and src/app/action-permissions.test.ts. Every value is
// synthetic.

const CLINIC = '01970000-0000-7000-8000-0000000000d1';
const TYPED: TypedFields = {
  firstName: 'Ana',
  lastName: 'Kodra',
  dateOfBirth: '1990-01-01',
  phone: '070 001 234',
  email: '',
};
const FOUND: LikelyDuplicate[] = [
  {
    id: '01970000-0000-7000-8000-0000000000d2',
    firstName: 'Ana',
    lastName: 'Kodra',
    dateOfBirth: '1990-01-01',
  },
];

function answering(result: ActionResult<LikelyDuplicate[]>) {
  return vi.fn(() => Promise.resolve(result));
}

describe('typedOf: what the check reads of the form', () => {
  it('the five fields a likely duplicate is found by, as typed, and none of the others', () => {
    const data = new FormData();
    data.append('firstName', ' Ana ');
    data.append('lastName', 'Kodra');
    data.append('dateOfBirth', '1990-01-01');
    data.append('phone', '070 001 234');
    data.append('email', 'ana.kodra@example.test');
    data.append('language', 'en');
    data.append('notes', 'Prefers mornings.');
    expect(typedOf(data)).toEqual({
      firstName: ' Ana ',
      lastName: 'Kodra',
      dateOfBirth: '1990-01-01',
      phone: '070 001 234',
      email: 'ana.kodra@example.test',
    });
  });

  it("a field the form does not hold, or holds as a file, is ''", () => {
    const data = new FormData();
    data.append('firstName', 'Ana');
    data.append('phone', new Blob(['070']), 'phone.txt');
    expect(typedOf(data)).toEqual({
      firstName: 'Ana',
      lastName: '',
      dateOfBirth: '',
      phone: '',
      email: '',
    });
  });
});

describe('sendCheck', () => {
  it("sends what is typed, as the check's input, with the clinic id given; names who it found", async () => {
    const read = answering({ ok: true, value: FOUND });
    expect(await sendCheck(read, CLINIC, TYPED)).toEqual(FOUND);
    expect(read).toHaveBeenCalledExactlyOnceWith(CLINIC, TYPED);
  });

  it.each([
    { code: 'clinic_changed' as const },
    { code: 'internal' as const },
    { code: 'forbidden' as const },
    { code: 'invalid_input' as const, issues: [{ path: ['dateOfBirth'], code: 'invalid_format' }] },
  ])('$code: no one named, as the warning only helps', async (error) => {
    expect(await sendCheck(answering({ ok: false, error }), CLINIC, TYPED)).toEqual([]);
  });

  it('a call that never got an answer: no one named, not an error', async () => {
    const read = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await sendCheck(read, CLINIC, TYPED)).toEqual([]);
  });

  it("Next.js's redirect after an ended session goes on, for Next.js to carry out", async () => {
    const toLogin = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    await expect(
      sendCheck(
        vi.fn(() => Promise.reject(toLogin)),
        CLINIC,
        TYPED,
      ),
    ).rejects.toBe(toLogin);
  });
});
