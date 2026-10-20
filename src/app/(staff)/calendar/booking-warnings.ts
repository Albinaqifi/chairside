import {
  holdsTheChair,
  type AppointmentBlock,
  type BreakBlock,
  type CalendarDayView,
  type Closed,
  type Span,
} from './day';

/*
 * What the new-appointment drawer warns of above Book (E01-T05b): pure functions, no React and no
 * clock, so the rules are unit-tested. They read the day the calendar holds now, which a read on use
 * and a booking's answer bring up to date (D-108), never the one read when the drawer opened, and
 * they change nothing chosen in the drawer.
 * - An overlap (D-020; demo line 1350, logic lines 1963, 2125): each visit of the provider the time
 *   overlaps that holds the chair, one booked anyway too. Book becomes Book anyway.
 * - A break of the provider, a time partly outside the day's opening hours, a day the clinic is closed
 *   (owner, D-114; the demo warns for lunch only). Book stays Book and books it.
 * Every place is in minutes from the day's local midnight on the clinic's clock, as the calendar's
 * blocks are, each cut only at midnight (./day.ts). On the two days the clocks change, a block's
 * minutes are the clock's, not real time: the server's check is the one that counts
 * (scheduling.createAppointment).
 */

export interface BookingWarnings {
  /** The provider's visits the time overlaps that hold the chair, by start. */
  overlaps: AppointmentBlock[];
  /** The provider's breaks the time overlaps, by start. */
  breaks: BreakBlock[];
  /**
   * The day's opening hours when the time runs outside them, in part or whole; null when it is inside
   * them, and on a day the clinic is closed, which `closed` says.
   */
  outsideHours: Span | null;
  /** Why the clinic is closed that day (a closed day with its label, a weekday without hours), or null. */
  closed: Closed | null;
}

export const NO_WARNINGS: BookingWarnings = {
  overlaps: [],
  breaks: [],
  outsideHours: null,
  closed: null,
};

/**
 * What a booking of `providerId` from `start` for `length` minutes is warned of on `day`: its
 * provider's column (one exists for a provider the filter has off too), the day's hours and why it is
 * closed. A provider without a column there (none chosen) has no visit or break to overlap.
 */
export function bookingWarnings(
  day: Pick<CalendarDayView, 'columns' | 'open' | 'closed'>,
  booking: { providerId: string; start: number; length: number },
): BookingWarnings {
  const time: Span = { from: booking.start, to: booking.start + booking.length };
  const blocks =
    day.columns.find((column) => column.providerId === booking.providerId)?.blocks ?? [];
  return {
    overlaps: blocks.filter(
      (block): block is AppointmentBlock =>
        block.kind === 'appointment' && holdsTheChair(block.status) && overlap(block, time),
    ),
    breaks: blocks.filter(
      (block): block is BreakBlock => block.kind === 'break' && overlap(block, time),
    ),
    outsideHours:
      day.open !== null && (time.from < day.open.from || time.to > day.open.to) ? day.open : null,
    closed: day.closed,
  };
}

/** True when the drawer warns of anything. */
export function anyWarning(warnings: BookingWarnings): boolean {
  return (
    warnings.overlaps.length > 0 ||
    warnings.breaks.length > 0 ||
    warnings.outsideHours !== null ||
    warnings.closed !== null
  );
}

/** Two spans overlap when each starts before the other ends: back to back is no overlap. */
function overlap(a: Span, b: Span): boolean {
  return a.from < b.to && b.from < a.to;
}
