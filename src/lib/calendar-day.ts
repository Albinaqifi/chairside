/**
 * Days of the calendar, without a time library (D-108): moved here from the seed (E01-T01b), so the
 * seed, the patients module and the calendar share one copy. A day is a date of the calendar,
 * `YYYY-MM-DD`, with no time and no zone: a clinic's day.
 *
 * The computer's own time zone is never read (`getDay()`, `setHours()`, `toLocaleString()`…): the
 * tests run once, in the computer's zone (UTC in CI, D-099), which would not show it. The clinic's
 * day comes from Intl.DateTimeFormat with the clinic's `timeZone`; days are counted in UTC, where
 * every day has 24 hours.
 */

/** A date of the calendar, `YYYY-MM-DD`: a clinic's day. */
export type CalendarDay = string;

const DAY_FORM = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** True for a date of the calendar written `YYYY-MM-DD`: `2026-02-30` is not one. */
export function isCalendarDay(value: unknown): value is CalendarDay {
  if (typeof value !== 'string' || !DAY_FORM.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** The day it is in this time zone at this moment, whatever the computer's own zone. */
export function dayInZone(moment: Date, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((found) => found.type === type)?.value ?? '';
  const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  if (!isCalendarDay(day)) {
    throw new RangeError('dayInZone: the moment gave no date of the calendar');
  }
  return day;
}

/** The day `n` days after this one, or before it for a negative `n`. */
export function addDays(day: CalendarDay, n: number): CalendarDay {
  return new Date(startOfDay(day) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** The ISO weekday: 1 = Monday … 7 = Sunday, as `clinic_hours`, `provider_breaks` and `isodow`. */
export function isoWeekday(day: CalendarDay): number {
  return new Date(startOfDay(day)).getUTCDay() || 7;
}

function startOfDay(day: CalendarDay): number {
  if (!isCalendarDay(day)) throw new RangeError('calendar-day: needs a day as YYYY-MM-DD');
  return Date.parse(`${day}T00:00:00Z`);
}
