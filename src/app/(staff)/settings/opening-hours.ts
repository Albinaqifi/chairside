import type { OpeningHours } from '@/modules/tenancy';

/*
 * The Opening hours tab (E01-T08b): its fields, the times its selects offer, and the values it starts
 * with. No React and no database: the page, the form and the action's schema all use it.
 *
 * A time is the browser's own select in steps of 15 minutes from 00:00 to 23:45, as the demo's booking
 * times are (logic line 1847): never the browser's time field, which shows a 12- or a 24-hour clock by
 * the computer's settings (D-049). Its value is `HH:MM`; its label is the formatter's (the form). A
 * stored time the steps lack (08:10, or 08:10:30, or 24:00, which PostgreSQL holds) is offered as it
 * is, so a save never changes a weekday nobody touched.
 */

/** Each ISO weekday, Monday first, with the word its fields' names start with. */
export const WEEKDAY_FIELDS = [
  { weekday: 1, key: 'monday' },
  { weekday: 2, key: 'tuesday' },
  { weekday: 3, key: 'wednesday' },
  { weekday: 4, key: 'thursday' },
  { weekday: 5, key: 'friday' },
  { weekday: 6, key: 'saturday' },
  { weekday: 7, key: 'sunday' },
] as const;

export type WeekdayKey = (typeof WEEKDAY_FIELDS)[number]['key'];

/**
 * A weekday's three fields, each a flat name the action's schema declares (action-input.ts shows any
 * other key as `*`): its switch (`mondayOpen`, "on" when open, not sent when closed) and its two times.
 */
export function hoursFieldNames(key: WeekdayKey): { open: string; opens: string; closes: string } {
  return { open: `${key}Open`, opens: `${key}Opens`, closes: `${key}Closes` };
}

/** The minutes between two times the select offers. */
export const TIME_STEP_MINUTES = 15;

const MINUTES_PER_DAY = 24 * 60;

/** A time's value: `HH:MM` from 00:00 to 23:59, with `:SS` when it has seconds, or 24:00. */
const TIME_VALUE = /^(?:([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?|24:00(?::00)?)$/;

/** A time's value as minutes from midnight (`08:10` is 490), or null when it is no time's value. */
export function minutesOfTimeValue(value: string): number | null {
  const match = TIME_VALUE.exec(value);
  if (!match) return null;
  if (match[1] === undefined) return MINUTES_PER_DAY; // 24:00
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] ?? 0) / 60;
}

/** Minutes from midnight as a time's value: `HH:MM`, or `HH:MM:SS` when it has seconds. */
export function timeValue(minutes: number): string {
  const seconds = Math.round(minutes * 60);
  const two = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}`;
  return seconds % 60 === 0 ? hhmm : `${hhmm}:${two(seconds % 60)}`;
}

/**
 * The times a select offers, as values in the order of the day: every 15 minutes from 00:00 to
 * 23:45, and the stored one where it falls when the steps lack it.
 */
export function timeChoices(stored: string): string[] {
  const steps: string[] = [];
  for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += TIME_STEP_MINUTES) {
    steps.push(timeValue(minutes));
  }
  const at = minutesOfTimeValue(stored);
  if (at === null || steps.includes(stored)) return steps;
  const before = steps.filter((value) => (minutesOfTimeValue(value) ?? 0) < at);
  return [...before, stored, ...steps.slice(before.length)];
}

/** One weekday as the form starts with it: open or closed, and its times, '' for none. */
export interface WeekdayHoursValues {
  weekday: number;
  key: WeekdayKey;
  open: boolean;
  opens: string;
  closes: string;
}

/** The week as the form starts with it, Monday first, from the clinic's rows (openingHours()). */
export function weekValues(hours: readonly OpeningHours[]): WeekdayHoursValues[] {
  return WEEKDAY_FIELDS.map(({ weekday, key }) => {
    const row = hours.find((found) => found.weekday === weekday);
    return row
      ? { weekday, key, open: true, opens: timeValue(row.opens), closes: timeValue(row.closes) }
      : { weekday, key, open: false, opens: '', closes: '' };
  });
}
