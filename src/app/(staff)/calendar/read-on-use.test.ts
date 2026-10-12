import { describe, expect, it, vi } from 'vitest';
import type { ActionResult } from '@/app/_lib/actions';
import type { CalendarRead } from './day';
import { readAgain, readIsDue, readTimeOf, READ_AGAIN_AFTER_MS, USE_EVENTS } from './read-on-use';

// E01-T04b (D-108): when the calendar reads its day again, and each answer of the read as the
// calendar shows it. The read is a stand-in that answers as told; the real one is checked in
// tests/integration/calendar-own-column.test.ts and src/app/action-permissions.test.ts, the reading
// on use in a browser in tests/e2e/calendar.spec.ts.

const CLINIC = '01970000-0000-7000-8000-0000000000c1';
const READ: CalendarRead = {
  view: {
    day: '2026-10-26',
    today: '2026-10-26',
    previous: '2026-10-25',
    next: '2026-10-27',
    closed: null,
    open: { from: 480, to: 1080 },
    grid: { from: 480, to: 1080 },
    shaded: [],
    appointmentCount: 0,
    columns: [],
  },
  ownProviderId: null,
};

function answering(result: ActionResult<CalendarRead>) {
  return vi.fn(() => Promise.resolve(result));
}

describe('a read is due 30 seconds after the last one started, never sooner', () => {
  const last = Date.parse('2026-10-26T09:00:00Z');

  it('not before', () => {
    expect(READ_AGAIN_AFTER_MS).toBe(30_000);
    expect(readIsDue(last, last)).toBe(false);
    expect(readIsDue(last, last + 29_999)).toBe(false);
  });

  it('from then on', () => {
    expect(readIsDue(last, last + 30_000)).toBe(true);
    expect(readIsDue(last, last + 3_600_000)).toBe(true);
  });

  it('at once when the browser’s clock was set back since', () => {
    expect(readIsDue(last, last - 1)).toBe(true);
  });
});

describe('when the day shown was read (tester finding 1: Back and Forward)', () => {
  const first = Date.parse('2026-10-26T09:00:00Z');

  it('a day drawn the first time: now, kept from then on', () => {
    const times = new WeakMap<object, number>();
    const day = { ...READ.view };
    expect(readTimeOf(times, day, first)).toBe(first);
    expect(times.get(day)).toBe(first);
  });

  it('the same day drawn again (Back, Forward): the time of its read, not now', () => {
    const times = new WeakMap<object, number>();
    const day = { ...READ.view };
    readTimeOf(times, day, first);
    expect(readTimeOf(times, day, first + 60_000)).toBe(first);
    expect(readIsDue(readTimeOf(times, day, first + 60_000), first + 60_000)).toBe(true);
  });

  it('a day a read on use brought: the time that read started', () => {
    const times = new WeakMap<object, number>();
    const day = { ...READ.view };
    times.set(day, first + 31_000);
    expect(readTimeOf(times, day, first + 40_000)).toBe(first + 31_000);
  });

  it('another day, even with the same rows: a read of its own', () => {
    const times = new WeakMap<object, number>();
    readTimeOf(times, { ...READ.view }, first);
    expect(readTimeOf(times, { ...READ.view }, first + 5_000)).toBe(first + 5_000);
  });
});

describe('what counts as using the page', () => {
  it('a pointer pressed, moved or turned, a key, a touch; focus and visibility on their own', () => {
    expect([...USE_EVENTS]).toEqual([
      'pointerdown',
      'pointermove',
      'wheel',
      'keydown',
      'touchstart',
    ]);
  });
});

describe('readAgain', () => {
  it("asks for the page's day, or null for today, with the clinic id given", async () => {
    const read = answering({ ok: true, value: READ });
    expect(await readAgain(read, CLINIC, '2026-10-26')).toEqual({ kind: 'read', read: READ });
    expect(read).toHaveBeenCalledWith(CLINIC, { day: '2026-10-26' });
    await readAgain(read, CLINIC, null);
    expect(read).toHaveBeenLastCalledWith(CLINIC, { day: null });
  });

  it('clinic_changed: the calendar asks for a reload', async () => {
    const read = answering({ ok: false, error: { code: 'clinic_changed' } });
    expect(await readAgain(read, CLINIC, null)).toEqual({ kind: 'clinic_changed' });
  });

  it.each([
    { code: 'internal' as const },
    { code: 'forbidden' as const },
    { code: 'invalid_input' as const, issues: [{ path: ['day'], code: 'custom' }] },
  ])('$code: the general failure', async (error) => {
    expect(await readAgain(answering({ ok: false, error }), CLINIC, null)).toEqual({
      kind: 'failed',
    });
  });

  it('a call that never got an answer: the general failure, not an error', async () => {
    const read = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await readAgain(read, CLINIC, null)).toEqual({ kind: 'failed' });
  });

  it("Next.js's redirect after an ended session goes on, for Next.js to carry out", async () => {
    const toLogin = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    await expect(
      readAgain(
        vi.fn(() => Promise.reject(toLogin)),
        CLINIC,
        null,
      ),
    ).rejects.toBe(toLogin);
  });
});
