import { addDays, isCalendarDay, isoWeekday, type CalendarDay } from '@/lib/calendar-day';

/**
 * The seed's week and its moments (E01-T01b), without a time library. A day is a date of the
 * calendar, `YYYY-MM-DD` (src/lib/calendar-day.ts, where the day helpers live since E01-T04a,
 * D-108). A moment is written as the clinic's local date and time with its zone's name,
 * `2026-10-26 09:00 Europe/Skopje`, which PostgreSQL turns into the moment when it stores a
 * timestamptz.
 *
 * The computer's own time zone is never read (`getDay()`, `setHours()`, `toLocaleString()`…): the
 * tests run once, in the computer's zone (UTC in CI, D-099), which would not show it.
 */

const TIME_FORM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;

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
