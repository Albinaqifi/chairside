import { createFormatter, createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from './en.json';
import { languageOf, LOCALE } from './locale';

// E01-T04b (D-049; owner, 2026-10-12): the app's one locale gives every format the 24-hour clock and
// leaves the dates English, set once (src/i18n/request.ts), never at a call. Each case names its
// zone; none relies on the computer's (D-099). The calendar and the patient list drawn with it:
// src/app/(staff)/calendar/day-calendar.test.ts, src/app/(staff)/patients/patient-list.test.ts.

/** Monday 26 October 2026, 13:05 UTC: 14:05 in Skopje, 09:05 in New York. */
const MOMENT = new Date('2026-10-26T13:05:00Z');

describe('the locale', () => {
  it.each([
    { zone: 'Europe/Skopje', time: '14:05', both: 'Mon, Oct 26, 14:05' },
    { zone: 'America/New_York', time: '09:05', both: 'Mon, Oct 26, 09:05' },
  ])('in $zone: a time of day "$time", with no AM or PM', ({ zone, time, both }) => {
    const format = createFormatter({ locale: LOCALE, timeZone: zone });
    expect(format.dateTime(MOMENT, { hour: 'numeric', minute: '2-digit' })).toBe(time);
    expect(
      format.dateTime(MOMENT, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }),
    ).toBe(both);
  });

  it('midnight is 00:00 and an hour of the grid reads 08:00', () => {
    const format = createFormatter({ locale: LOCALE, timeZone: 'UTC' });
    const hour = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } as const;
    expect(format.dateTime(new Date(Date.UTC(2000, 0, 1, 0)), hour)).toBe('00:00');
    expect(format.dateTime(new Date(Date.UTC(2000, 0, 1, 8)), hour)).toBe('08:00');
  });

  it('dates stay English: "Monday, October 26", "Mar 12, 2026"', () => {
    const format = createFormatter({ locale: LOCALE, timeZone: 'UTC' });
    expect(
      format.dateTime(new Date('2026-10-26'), { weekday: 'long', day: 'numeric', month: 'long' }),
    ).toBe('Monday, October 26');
    expect(
      format.dateTime(new Date('2026-03-12'), { day: 'numeric', month: 'short', year: 'numeric' }),
    ).toBe('Mar 12, 2026');
  });

  it("English plurals and numbers in the message file's texts", () => {
    const t = createTranslator({ locale: LOCALE, messages });
    expect(t('calendar.summary', { appointments: 1, chairs: 2 })).toBe('1 appointment · 2 chairs');
    expect(t('patients.count', { count: 1146 })).toBe('1,146 patients');
  });

  it('the page’s language is English: `en`, without the extension', () => {
    expect(languageOf(LOCALE)).toBe('en');
  });
});
