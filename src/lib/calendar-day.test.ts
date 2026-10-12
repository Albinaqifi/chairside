import { describe, expect, it } from 'vitest';
import { addDays, dayInZone, isCalendarDay, isoWeekday } from './calendar-day';

// The day helpers, without a time library and never in the computer's own time zone. Moved with
// the helpers (E01-T04a, D-108), none dropped: the first two groups from src/db/seed/seed-day.test.ts
// (E01-T01b), the last from src/modules/patients/list.test.ts (E01-T02a). These tests run once, in
// the computer's zone (UTC in CI, D-099): each names the zones it checks.

describe('the day it is in the clinic', () => {
  it('is the date in the zone of the clinic, not in UTC and not on this computer', () => {
    // 23:30 UTC on 25 October is 00:30 on the 26th in Skopje (winter time from that night on).
    expect(dayInZone(new Date('2026-10-25T23:30:00Z'), 'Europe/Skopje')).toBe('2026-10-26');
    expect(dayInZone(new Date('2026-10-25T22:30:00Z'), 'Europe/Skopje')).toBe('2026-10-25');
    // Summer time: 22:30 UTC on 30 June is 00:30 on 1 July in Skopje.
    expect(dayInZone(new Date('2026-06-30T22:30:00Z'), 'Europe/Skopje')).toBe('2026-07-01');
    // 13:00 UTC on 1 July is 15:00 in Skopje and already 2 July in Auckland.
    expect(dayInZone(new Date('2026-07-01T13:00:00Z'), 'Europe/Skopje')).toBe('2026-07-01');
    expect(dayInZone(new Date('2026-07-01T13:00:00Z'), 'Pacific/Auckland')).toBe('2026-07-02');
  });

  it('stays the same day from its first minute to its last', () => {
    // 26 October 2026 in Skopje runs from 23:00 UTC on the 25th to 22:59 UTC on the 26th.
    for (const moment of ['2026-10-25T23:00:00Z', '2026-10-26T11:00:00Z', '2026-10-26T22:59:59Z']) {
      expect(dayInZone(new Date(moment), 'Europe/Skopje'), moment).toBe('2026-10-26');
    }
  });
});

describe('days of the calendar', () => {
  it('are written YYYY-MM-DD and exist', () => {
    for (const day of ['2026-10-26', '2028-02-29', '2026-12-31'])
      expect(isCalendarDay(day)).toBe(true);
    for (const day of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-05', '26-10-2026', '']) {
      expect(isCalendarDay(day), day).toBe(false);
    }
    expect(isCalendarDay(20261026)).toBe(false);
  });

  it('add and take away across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-26', -7)).toBe('2026-10-19');
    // Across the night the clocks go back: still one day.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('give their ISO weekday, 1 for Monday to 7 for Sunday', () => {
    expect(['2026-10-26', '2026-10-27', '2026-10-31', '2026-11-01'].map(isoWeekday)).toEqual([
      1, 2, 6, 7,
    ]);
  });

  it('refuse to count from something that is not a day', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => isoWeekday('next monday')).toThrow(RangeError);
  });
});

describe("dayInZone: the clinic's today, whatever the computer's zone", () => {
  // 23:30 UTC on 7 October is already 8 October in Skopje (UTC+2 in summer time) and in Auckland.
  const lateEvening = new Date('2026-10-07T23:30:00Z');

  it.each([
    { zone: 'UTC', day: '2026-10-07' },
    { zone: 'Europe/Skopje', day: '2026-10-08' },
    { zone: 'Pacific/Auckland', day: '2026-10-08' },
    { zone: 'America/New_York', day: '2026-10-07' },
  ])('$zone: $day', ({ zone, day }) => {
    expect(dayInZone(lateEvening, zone)).toBe(day);
  });
});
