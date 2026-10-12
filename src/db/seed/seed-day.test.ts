import { describe, expect, it } from 'vitest';
import { addMinutes, localMoment, minutesOf, seedWeek } from './seed-day';

// E01-T01b: the seed's week and its moments, without a time library and never in the computer's own
// time zone. These tests run once, in the computer's zone (UTC in CI), so a helper that read that
// zone could pass here; D-099 accepts it, as the seed runs on this machine only. The day helpers'
// cases moved with them to src/lib/calendar-day.test.ts (E01-T04a, D-108).

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
