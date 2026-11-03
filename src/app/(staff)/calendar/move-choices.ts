import { dayInZone, type CalendarDay } from '@/lib/calendar-day';
import { bookableProviders, startChoices } from './booking-choices';
import type { CalendarDayView, Column, Span } from './day';
import { minuteInZone } from './now-line';

/*
 * What the appointment drawer's move form starts on and offers (E01-T06f): no React and no database,
 * so the rules are unit-tested in several zones. The form works as the booking drawer does, in the
 * calendar's minutes from a day's local midnight (./booking-choices.ts).
 */

/** Where a visit is now: the clinic's day of its start, the minute of the day, the length in minutes. */
export interface Place {
  day: CalendarDay;
  start: number;
  length: number;
}

/**
 * The visit's own place, from its two moments and the clinic's zone. Not from the block's `from`: a
 * block is cut at midnight, so a visit that runs past it shows on the next day from 00:00 and its
 * start is on the day before. The length is real time, as the move keeps it (scheduling.moveAppointment).
 */
export function placeOf(startsAt: string, endsAt: string, timeZone: string): Place {
  const starts = new Date(startsAt);
  return {
    day: dayInZone(starts, timeZone),
    start: minuteInZone(starts, timeZone),
    length: Math.round((new Date(endsAt).getTime() - starts.getTime()) / 60_000),
  };
}

/**
 * The starts the move form offers on a day: its grid's quarter hours, and the start the form holds
 * when it is none of them (the visit's own 09:10, or a time of another day's wider grid), so a change
 * of day never moves the time under the person.
 */
export function startChoicesWith(grid: Span, also: number): number[] {
  const starts = startChoices(grid);
  if (starts.includes(also)) return starts;
  return [...starts, also].sort((a, b) => a - b);
}

/**
 * The provider the form starts on: the visit's own while that provider is active, else the first
 * active one (a visit whose provider was made inactive can only move away), else none (''): a clinic
 * without an active provider.
 */
export function firstMoveProvider(
  columns: readonly Column[],
  own: { providerId: string; active: boolean },
): string {
  const providers = bookableProviders(columns);
  if (own.active) return own.providerId;
  return providers[0]?.id ?? '';
}

/** Another day's read: its view, or null when the read did not work. */
export interface OtherDay {
  day: CalendarDay;
  view: CalendarDayView | null;
}

/** The day the form points at, as far as it is known. */
export interface PointedDay {
  /** The view the form's warnings and choices come from. */
  view: CalendarDayView;
  /**
   * `ok`: `view` is the day pointed at, or the last day shown while a later read is on its way (the
   * old warnings kept until the new answer comes). `pending`: nothing to show yet (the form started
   * on a day the calendar does not hold, and its read is on its way). `failed`: the read did not
   * work, so the box is empty and a line says the day could not be checked.
   */
  state: 'ok' | 'pending' | 'failed';
}

/**
 * Where the form takes its warnings and choices from: the day the calendar holds when the form points
 * at it, else the last read of another day (./appointment-move.tsx reads it when the date changes to a
 * complete day). `started` is the day the form started on: while no other day has been read, the
 * calendar's day stays the one shown if the form started on it.
 */
export function pointedDay(
  pointed: CalendarDay,
  held: CalendarDayView,
  other: OtherDay | null,
  started: CalendarDay,
): PointedDay {
  if (pointed === held.day) return { view: held, state: 'ok' };
  if (other === null) return { view: held, state: started === held.day ? 'ok' : 'pending' };
  if (other.view === null) return { view: held, state: 'failed' };
  return { view: other.view, state: 'ok' };
}
