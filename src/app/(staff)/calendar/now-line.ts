import { dayInZone } from '@/lib/calendar-day';
import type { Span } from './day';

/*
 * The "now" line (E01-T04b, demo lines 273–275): where it is on the day shown, by the browser's clock
 * in the clinic's zone. No React here, so the rule is unit-tested in several zones; the calendar
 * (./calendar-screen.tsx) reads the clock once it is in the browser and again each minute, and sends
 * no request for it.
 */

/** A minute, in milliseconds: the line moves once a minute. */
export const MINUTE_MS = 60_000;

/**
 * The minute of the day at this moment on the clinic's clock, from its local midnight: 14:30 is 870.
 * As the calendar places its blocks (the scheduling module's minutes, wall-clock time), so the line
 * and a visit at the same time sit at the same place, on a day of 23 or 25 hours too.
 */
export function minuteInZone(moment: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    numberingSystem: 'latn',
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((found) => found.type === type)?.value);
  const minute = part('hour') * 60 + part('minute');
  if (!Number.isInteger(minute)) throw new RangeError('minuteInZone: the moment gave no time');
  return minute;
}

/**
 * The minute at which the line shows on this day, or null: none unless the clinic's today (by the
 * browser's clock, in its zone) is the day shown, and none while the time is outside the grid.
 */
export function nowLineMinute(
  now: Date,
  timeZone: string,
  shown: { day: string; grid: Span },
): number | null {
  if (dayInZone(now, timeZone) !== shown.day) return null;
  const minute = minuteInZone(now, timeZone);
  return minute >= shown.grid.from && minute < shown.grid.to ? minute : null;
}

/** How long until the clock reaches its next whole minute, when the line moves. */
export function untilNextMinute(nowMs: number): number {
  return MINUTE_MS - (((nowMs % MINUTE_MS) + MINUTE_MS) % MINUTE_MS);
}
