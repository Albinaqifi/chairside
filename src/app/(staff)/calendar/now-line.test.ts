import { describe, expect, it } from 'vitest';
import { MINUTE_MS, minuteInZone, nowLineMinute, untilNextMinute } from './now-line';

// E01-T04b: where the "now" line is, from a moment of the browser's clock and the clinic's zone.
// Each case names its zone, one behind UTC among them, and none relies on the computer's (D-099).
// The line drawn in a browser, its clock set by Playwright: tests/e2e/calendar.spec.ts.

const H = 60;
const DAY_8_TO_6 = { from: 8 * H, to: 18 * H };
const WHOLE_DAY = { from: 0, to: 24 * H };

describe("the minute of the day on the clinic's clock", () => {
  it.each([
    // 26 October 2026: Skopje on winter time (UTC+1) since the night before.
    { zone: 'Europe/Skopje', at: '2026-10-26T09:00:00Z', minute: 10 * H },
    { zone: 'Europe/Skopje', at: '2026-10-25T23:00:00Z', minute: 0 },
    // 29 March 2026: Skopje moved to summer time (UTC+2) at 02:00, so 01:30 UTC is 03:30.
    { zone: 'Europe/Skopje', at: '2026-03-29T01:30:00Z', minute: 3 * H + 30 },
    // Behind UTC: 03:30 UTC on 9 March is 23:30 on 8 March in New York.
    { zone: 'America/New_York', at: '2026-03-09T03:30:00Z', minute: 23 * H + 30 },
    // Ahead: 23:30 UTC on 25 October is 12:30 on 26 October in Auckland (UTC+13).
    { zone: 'Pacific/Auckland', at: '2026-10-25T23:30:00Z', minute: 12 * H + 30 },
    { zone: 'UTC', at: '2026-10-26T14:59:59Z', minute: 14 * H + 59 },
  ])('$zone at $at: minute $minute', ({ zone, at, minute }) => {
    expect(minuteInZone(new Date(at), zone)).toBe(minute);
  });
});

describe('the "now" line on the day shown', () => {
  it("on the clinic's today, at its time in the clinic's zone", () => {
    const now = new Date('2026-10-26T09:05:00Z');
    expect(nowLineMinute(now, 'Europe/Skopje', { day: '2026-10-26', grid: DAY_8_TO_6 })).toBe(
      10 * H + 5,
    );
  });

  it('none on any other day: the day before and the day after', () => {
    const now = new Date('2026-10-26T09:05:00Z');
    for (const day of ['2026-10-25', '2026-10-27']) {
      expect(nowLineMinute(now, 'Europe/Skopje', { day, grid: DAY_8_TO_6 }), day).toBeNull();
    }
  });

  it('in a zone behind UTC: still the day before UTC’s, at its late hour', () => {
    // UTC is already on 9 March; the clinic in New York is on the 8th, at 23:30.
    const now = new Date('2026-03-09T03:30:00Z');
    expect(nowLineMinute(now, 'America/New_York', { day: '2026-03-08', grid: WHOLE_DAY })).toBe(
      23 * H + 30,
    );
    expect(
      nowLineMinute(now, 'America/New_York', { day: '2026-03-09', grid: WHOLE_DAY }),
    ).toBeNull();
  });

  it('in a zone ahead of UTC: already the next day', () => {
    const now = new Date('2026-10-25T23:30:00Z');
    expect(nowLineMinute(now, 'Pacific/Auckland', { day: '2026-10-26', grid: DAY_8_TO_6 })).toBe(
      12 * H + 30,
    );
    expect(
      nowLineMinute(now, 'Pacific/Auckland', { day: '2026-10-25', grid: DAY_8_TO_6 }),
    ).toBeNull();
  });

  it.each([
    { what: 'before the grid', at: '2026-10-26T06:59:00Z' }, // 07:59
    { what: 'at its end', at: '2026-10-26T17:00:00Z' }, // 18:00
    { what: 'after it', at: '2026-10-26T19:30:00Z' }, // 20:30
  ])('none $what', ({ at }) => {
    expect(
      nowLineMinute(new Date(at), 'Europe/Skopje', { day: '2026-10-26', grid: DAY_8_TO_6 }),
    ).toBeNull();
  });

  it('at the first minute of the grid, and at its last', () => {
    const shown = { day: '2026-10-26', grid: DAY_8_TO_6 };
    expect(nowLineMinute(new Date('2026-10-26T07:00:00Z'), 'Europe/Skopje', shown)).toBe(8 * H);
    expect(nowLineMinute(new Date('2026-10-26T16:59:00Z'), 'Europe/Skopje', shown)).toBe(
      18 * H - 1,
    );
  });
});

describe('the next whole minute, when the line moves', () => {
  it('is a minute away on a whole minute, and less within one', () => {
    const minute = Date.parse('2026-10-26T09:05:00Z');
    expect(untilNextMinute(minute)).toBe(MINUTE_MS);
    expect(untilNextMinute(minute + 1)).toBe(MINUTE_MS - 1);
    expect(untilNextMinute(minute + 59_999)).toBe(1);
  });
});
