import { dayInZone, type CalendarDay } from '@/lib/calendar-day';
import type { TreatmentType } from '@/modules/scheduling';
import type { CalendarDayView, Column, Span } from './day';
import { minuteInZone } from './now-line';

/*
 * What the new-appointment drawer offers (E01-T05a, demo logic lines 1619–1621, 2116–2118), and what
 * each choice starts on. No React and no database: the drawer and the booking action's schema use it,
 * and the rules are unit-tested in several zones.
 *
 * A start is a local time on the day the calendar shows, as minutes from its local midnight on the
 * clinic's clock, as the calendar places its blocks; its value in the form is `HH:MM` (as the opening
 * hours' times are, E01-T08b), its label the formatter's, in the 24-hour clock (D-049). Every choice
 * is the browser's own select: no number is typed.
 */

/** The minutes between two starts the drawer offers: the grid's quarter hours. */
export const START_STEP_MINUTES = 15;

/** The lengths the drawer offers, in minutes (the demo's); a treatment's own joins them. */
export const LENGTHS: readonly number[] = [15, 30, 45, 60, 90, 120];

/** The length a booking has before a treatment is picked: the demo's (logic line 1621). */
export const FIRST_LENGTH = 30;

/** The longest length a booking takes, in minutes: a day. */
export const LENGTH_MAX = 24 * 60;

/** A start's value: `HH:MM`, from 00:00 to 23:59. */
const START_VALUE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A start as its value: 540 is `09:00`. */
export function startValue(minutes: number): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
}

/** A start's value as minutes from midnight (`09:00` is 540), or null when it is no start's value. */
export function minutesOfStart(value: string): number | null {
  const match = START_VALUE.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The starts the drawer offers: each quarter hour of the grid, from its start to its last quarter. */
export function startChoices(grid: Span): number[] {
  const starts: number[] = [];
  const first = Math.ceil(grid.from / START_STEP_MINUTES) * START_STEP_MINUTES;
  for (let minutes = first; minutes < grid.to; minutes += START_STEP_MINUTES) starts.push(minutes);
  return starts;
}

/** The clinic's now, by the browser's clock in the clinic's zone: its day, and its minute of the day. */
export interface ClinicNow {
  day: CalendarDay;
  minute: number;
}

/** This moment on the clinic's clock, as the "now" line reads it (./now-line.ts). */
export function clinicNow(moment: Date, timeZone: string): ClinicNow {
  return { day: dayInZone(moment, timeZone), minute: minuteInZone(moment, timeZone) };
}

/**
 * The start a booking begins with (E01-T05a): on the clinic's today, the next quarter hour after its
 * now while that is inside the day's hours; else the day's opening, or the grid's start on a closed
 * day. Always one of `startChoices(view.grid)`: the first from it on (an opening at 08:10 begins at
 * 08:15), the grid's last when none is.
 */
export function firstStart(
  view: Pick<CalendarDayView, 'day' | 'open' | 'grid'>,
  now: ClinicNow | null,
): number {
  let wanted = view.open?.from ?? view.grid.from;
  if (now !== null && now.day === view.day && view.open !== null) {
    const next = (Math.floor(now.minute / START_STEP_MINUTES) + 1) * START_STEP_MINUTES;
    if (next >= view.open.from && next < view.open.to) wanted = next;
  }
  const starts = startChoices(view.grid);
  return starts.find((start) => start >= wanted) ?? starts[starts.length - 1] ?? view.grid.from;
}

/** The lengths offered: LENGTHS and each of `also` (a treatment's own, the length chosen), in order. */
export function lengthChoices(...also: (number | null)[]): number[] {
  const lengths = new Set(LENGTHS);
  for (const length of also) if (length !== null) lengths.add(length);
  return [...lengths].sort((a, b) => a - b);
}

/** A provider a booking can take, as the drawer's select names it. */
export interface BookableProvider {
  id: string;
  /** `providers.short_name`: the select's option, and Book's text (demo logic line 2127). */
  shortName: string;
}

/**
 * The providers a booking can take: the day's columns of active providers, in the calendar's order.
 * Every active provider has a column (./day.ts); an inactive one shown for a visit that day is none.
 */
export function bookableProviders(columns: readonly Column[]): BookableProvider[] {
  return columns
    .filter((column) => column.active)
    .map((column) => ({ id: column.providerId, shortName: column.shortName }));
}

/**
 * The provider a booking begins with: the first column shown whose provider is active, else the first
 * active provider, else null (a clinic without one).
 */
export function firstProvider(columns: readonly Column[], shown: readonly string[]): string | null {
  const active = bookableProviders(columns);
  const firstShown = shown.find((id) => active.some((provider) => provider.id === id));
  return firstShown ?? active[0]?.id ?? null;
}

/**
 * An empty slot of the calendar's grid that a click opened the drawer on (E01-T05c): its column's
 * provider and the quarter hour under the pointer, in minutes from the day's local midnight.
 */
export interface Slot {
  providerId: string;
  start: number;
}

/**
 * What the drawer offers, and what it begins with, read once when it opens and kept while it is open:
 * a read on use that changes the calendar's day under it changes nothing typed or chosen in it, and a
 * booking is made on the day its title names.
 */
export interface BookingChoices {
  /** The day the calendar shows: the booking's day. */
  day: CalendarDay;
  /** The clinic's today, as the calendar's read gave it: a day of another year shows its year. */
  today: CalendarDay;
  starts: number[];
  firstStart: number;
  providers: BookableProvider[];
  firstProviderId: string | null;
  treatmentTypes: readonly TreatmentType[];
}

/**
 * The drawer's choices for the day shown, the columns shown, and the clinic's now (null if unknown).
 * Opened on an empty slot of the grid (E01-T05c), it begins on the slot's start and provider instead:
 * each only when the drawer offers it (a start of the grid, an active provider), else the first one.
 */
export function bookingChoices(
  view: CalendarDayView,
  treatmentTypes: readonly TreatmentType[],
  shown: readonly string[],
  now: ClinicNow | null,
  slot: Slot | null = null,
): BookingChoices {
  const starts = startChoices(view.grid);
  const providers = bookableProviders(view.columns);
  return {
    day: view.day,
    today: view.today,
    starts,
    firstStart: slot !== null && starts.includes(slot.start) ? slot.start : firstStart(view, now),
    providers,
    firstProviderId:
      slot !== null && providers.some((provider) => provider.id === slot.providerId)
        ? slot.providerId
        : firstProvider(view.columns, shown),
    treatmentTypes,
  };
}
