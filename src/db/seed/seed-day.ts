/**
 * The seed's day and the week it fills (E01-T01b), without a time library. A day is a date of the
 * calendar, `YYYY-MM-DD`, with no time and no zone: the clinic's day. A moment is written as the
 * clinic's local date and time with its zone's name, `2026-10-26 09:00 Europe/Skopje`, which
 * PostgreSQL turns into the moment when it stores a timestamptz.
 *
 * The computer's own time zone is never read (`getDay()`, `setHours()`, `toLocaleString()`…): CI
 * runs the tests again in Pacific/Auckland. The clinic's day comes from Intl.DateTimeFormat with
 * the clinic's `timeZone`; days are counted in UTC, where every day has 24 hours.
 */

/** A date of the calendar, `YYYY-MM-DD`: a clinic's day. */
export type CalendarDay = string;

const DAY_FORM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;

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

/**
 * The working week the seed fills for this day: Monday to Friday of the week the day is in, or of
 * the next week when the day is a Saturday or a Sunday.
 */
export function seedWeek(day: CalendarDay): CalendarDay[] {
  const weekday = isoWeekday(day);
  const monday = addDays(day, weekday <= 5 ? 1 - weekday : 8 - weekday);
  return [0, 1, 2, 3, 4].map((n) => addDays(monday, n));
}

/** A moment as PostgreSQL reads it into a timestamptz: the clinic's date and time, and its zone. */
export function localMoment(day: CalendarDay, time: string, timeZone: string): string {
  if (!isCalendarDay(day) || !TIME_FORM.test(time)) {
    throw new RangeError('localMoment: needs a day as YYYY-MM-DD and a time as HH:MM');
  }
  return `${day} ${time} ${timeZone}`;
}

/** Minutes since midnight of a time of day, `HH:MM`. */
export function minutesOf(time: string): number {
  if (!TIME_FORM.test(time)) throw new RangeError('minutesOf: needs a time as HH:MM');
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** The time of day `minutes` after this one, `HH:MM`, on the same day. */
export function addMinutes(time: string, minutes: number): string {
  const total = minutesOf(time) + minutes;
  if (!Number.isInteger(total) || total < 0 || total >= MINUTES_PER_DAY) {
    throw new RangeError('addMinutes: the time must stay within its day');
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function startOfDay(day: CalendarDay): number {
  if (!isCalendarDay(day)) throw new RangeError('seed-day: needs a day as YYYY-MM-DD');
  return Date.parse(`${day}T00:00:00Z`);
}
