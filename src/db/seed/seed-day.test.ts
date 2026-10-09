import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  dayInZone,
  isCalendarDay,
  isoWeekday,
  localMoment,
  minutesOf,
  seedWeek,
} from './seed-day';

// E01-T01b: the seed's day and its week, without a time library and never in the computer's own
// time zone. These tests run once, in the computer's zone (UTC in CI), so a helper that read that
// zone could pass here; D-099 accepts it, as the seed runs on this machine only.

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

describe('the week the seed fills', () => {
  const MONDAY_TO_FRIDAY = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];

  it('is Monday to Friday of the week a weekday is in', () => {
    for (const day of MONDAY_TO_FRIDAY) expect(seedWeek(day), day).toEqual(MONDAY_TO_FRIDAY);
  });

  it('is the next week on a Saturday or a Sunday', () => {
    const next = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    expect(seedWeek('2026-10-31')).toEqual(next);
    expect(seedWeek('2026-11-01')).toEqual(next);
    // The Sunday the clocks go back is followed by the week of 26 October.
    expect(seedWeek('2026-10-25')).toEqual(MONDAY_TO_FRIDAY);
  });

  it('runs across a year end', () => {
    expect(seedWeek('2026-12-31')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(seedWeek('2027-01-02')[0]).toBe('2027-01-04');
  });
});

describe('moments and times of day', () => {
  it('a moment is the local date and time with the name of the zone, which PostgreSQL reads', () => {
    expect(localMoment('2026-10-26', '09:00', 'Europe/Skopje')).toBe(
      '2026-10-26 09:00 Europe/Skopje',
    );
    expect(() => localMoment('2026-10-26', '9:00', 'Europe/Skopje')).toThrow(RangeError);
    expect(() => localMoment('2026-02-30', '09:00', 'Europe/Skopje')).toThrow(RangeError);
  });

  it('times of day add up within their day', () => {
    expect(minutesOf('08:00')).toBe(480);
    expect(minutesOf('18:00')).toBe(1080);
    expect(addMinutes('11:30', 45)).toBe('12:15');
    expect(addMinutes('08:00', 600)).toBe('18:00');
    expect(() => addMinutes('23:30', 30)).toThrow(RangeError);
    expect(() => minutesOf('24:00')).toThrow(RangeError);
  });
});
