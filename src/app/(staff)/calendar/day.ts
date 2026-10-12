import { addDays, isCalendarDay, type CalendarDay } from '@/lib/calendar-day';
import type { PatientName } from '@/modules/patients';
import type {
  AppointmentStatus,
  DayAppointment,
  Provider,
  ProviderBreak,
} from '@/modules/scheduling';
import type { ClosedDay, OpeningHours } from '@/modules/tenancy';

/*
 * The calendar's day (E01-T04a), laid out: pure functions, no database and no clock. Every place is
 * in minutes from the day's local midnight on the clinic's clock (the scheduling and tenancy modules
 * give them so), so a day of 23 or 25 hours places each block at its local time. The page turns
 * minutes into pixels (day-calendar.tsx).
 */

/** Minutes in a day on the clinic's clock: a block that runs past it is cut at midnight. */
export const MINUTES_PER_DAY = 24 * 60;

/** The grid when the clinic has no opening hours at all: 08:00 to 18:00. */
const NO_HOURS_GRID: Span = { from: 8 * 60, to: 18 * 60 };

/** The statuses whose minutes are not booked time: the chair is free again. */
const NOT_BOOKED: ReadonlySet<AppointmentStatus> = new Set(['cancelled', 'no_show']);

/** The first day the calendar can show: PostgreSQL has no year 0, so `0000-12-31` is no day of it. */
const FIRST_DAY: CalendarDay = '0001-01-01';

/** A span of the day, in minutes from its local midnight: from `from` up to `to`, not including it. */
export interface Span {
  from: number;
  to: number;
}

/** True for a day the calendar can show: a date of the calendar, from the year 1 on. */
export function isShownDay(value: unknown): value is CalendarDay {
  return isCalendarDay(value) && value >= FIRST_DAY;
}

/**
 * The day the address asks for (`?day=YYYY-MM-DD`), or null for the clinic's today: anything but one
 * day the calendar can show (none, a repeated `?day=`, `2026-02-30`, a word) is today.
 */
export function askedDay(value: string | string[] | undefined): CalendarDay | null {
  return typeof value === 'string' && isShownDay(value) ? value : null;
}

/** The clinic's rows for one day, as the calendar's read gathers them from the modules. */
export interface DayRows {
  day: CalendarDay;
  /** The clinic's today, in its zone. */
  today: CalendarDay;
  /** The day's ISO weekday. */
  weekday: number;
  /** The clinic's opening hours on every weekday it opens. */
  hours: readonly OpeningHours[];
  /** The day's `closed_days` row, or null. */
  closedDay: ClosedDay | null;
  /** Every provider of the clinic, active or not, in the calendar's order. */
  providers: readonly Provider[];
  /** The breaks of every provider on the day's weekday. */
  breaks: readonly ProviderBreak[];
  /** The appointments that overlap the day, each with its patient's name. */
  appointments: readonly (DayAppointment & { patient: PatientName })[];
}

/** Why the clinic is closed on a day: a `closed_days` row, with its label, or no hours that weekday. */
export type Closed = { why: 'closed_day'; label: string } | { why: 'no_hours' };

/** Where a block shows in its column: its span, cut to the grid, and its lane of `lanes`. */
export interface Placed extends Span {
  lane: number;
  lanes: number;
}

export interface AppointmentBlock extends Placed {
  kind: 'appointment';
  id: string;
  /** When it starts and ends, ISO: the page shows the time in the clinic's zone. */
  startsAt: string;
  endsAt: string;
  patient: PatientName;
  title: string;
  status: AppointmentStatus;
  note: string;
}

export interface BreakBlock extends Placed {
  kind: 'break';
  id: string;
  label: string;
}

export type Block = AppointmentBlock | BreakBlock;

/** One provider's column. */
export interface Column {
  providerId: string;
  name: string;
  initials: string;
  chairLabel: string;
  hue: number;
  /** Null on a closed day, and when breaks fill the hours. */
  percentBooked: number | null;
  /** By start: appointments and breaks; blocks that overlap sit side by side. */
  blocks: Block[];
}

/** The day as the calendar shows it. */
export interface CalendarDayView {
  day: CalendarDay;
  today: CalendarDay;
  previous: CalendarDay;
  next: CalendarDay;
  /** Null when the clinic is open that day. */
  closed: Closed | null;
  /** The day's opening hours; null when closed. */
  open: Span | null;
  /** The hours the grid runs, whole hours. */
  grid: Span;
  /** The parts of the grid outside the day's hours, shaded: all of it on a closed day. */
  shaded: Span[];
  /** Every appointment of the day, of every status. */
  appointmentCount: number;
  columns: Column[];
}

/**
 * The day laid out: a column for each active provider, and for an inactive one with an appointment
 * that day, so no appointment is ever hidden; their breaks; the grid from the clinic's earliest
 * opening to its latest closing in the week, widened to the day's blocks; what is outside the day's
 * hours; each column's % booked.
 */
export function layoutDay(rows: DayRows): CalendarDayView {
  const hours = rows.hours.find((found) => found.weekday === rows.weekday);
  const closed: Closed | null = rows.closedDay
    ? { why: 'closed_day', label: rows.closedDay.label }
    : hours
      ? null
      : { why: 'no_hours' };
  const open = closed === null && hours ? { from: hours.opens, to: hours.closes } : null;
  // Of any status: a cancelled visit of a provider who has left is still shown.
  const withVisits = new Set(rows.appointments.map((appointment) => appointment.providerId));
  const providers = rows.providers.filter(
    (provider) => provider.active || withVisits.has(provider.id),
  );
  const shown = new Set(providers.map((provider) => provider.id));
  const breaks = rows.breaks.filter((found) => shown.has(found.providerId));
  const grid = gridSpan(rows.hours, [
    ...rows.appointments.map((appointment) => spanOf(appointment)),
    ...breaks.map((found) => spanOf(found)),
  ]);
  return {
    day: rows.day,
    today: rows.today,
    previous: addDays(rows.day, -1),
    next: addDays(rows.day, 1),
    closed,
    open,
    grid,
    shaded: outsideHours(open, grid),
    appointmentCount: rows.appointments.length,
    columns: providers.map((provider) =>
      columnOf(
        provider,
        rows.appointments.filter((appointment) => appointment.providerId === provider.id),
        breaks.filter((found) => found.providerId === provider.id),
        open,
        grid,
      ),
    ),
  };
}

function columnOf(
  provider: Provider,
  appointments: readonly (DayAppointment & { patient: PatientName })[],
  breaks: readonly ProviderBreak[],
  open: Span | null,
  grid: Span,
): Column {
  // For blocks of the same span, a visit that holds the chair comes before a cancelled one or a
  // no-show (the rebooked visit, then the one it replaced), and both before a break.
  const visits = [...appointments].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      Number(NOT_BOOKED.has(a.status)) - Number(NOT_BOOKED.has(b.status)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const blocks: Block[] = [
    ...visits.map((appointment): Block => ({
      kind: 'appointment',
      id: appointment.id,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      patient: appointment.patient,
      title: appointment.title,
      status: appointment.status,
      note: appointment.note,
      ...spanOf(appointment),
      lane: 0,
      lanes: 1,
    })),
    ...breaks.map((found): Block => ({
      kind: 'break',
      id: found.id,
      label: found.label,
      ...spanOf(found),
      lane: 0,
      lanes: 1,
    })),
  ];
  return {
    providerId: provider.id,
    name: provider.name,
    initials: initialsOf(provider.name),
    chairLabel: provider.chairLabel,
    hue: provider.colorHue,
    percentBooked: percentBooked(
      open,
      appointments.map((appointment) => ({ ...spanOf(appointment), status: appointment.status })),
      breaks.map((found) => spanOf(found)),
    ),
    blocks: placeInLanes(blocks).map((block) => ({
      ...block,
      from: Math.max(block.from, grid.from),
      to: Math.min(block.to, grid.to),
    })),
  };
}

function spanOf(item: { startMinute: number; endMinute: number }): Span {
  return { from: item.startMinute, to: item.endMinute };
}

/**
 * A column's % booked (scope ✏️): the minutes of its appointments that are not cancelled or a
 * no-show, inside the day's hours, over the hours' minutes less the provider's breaks, rounded.
 * Overlapping visits each count, so it may pass 100. Null on a closed day (`open` null), and when
 * the breaks leave no open time.
 */
export function percentBooked(
  open: Span | null,
  appointments: readonly (Span & { status: AppointmentStatus })[],
  breaks: readonly Span[],
): number | null {
  if (open === null) return null;
  const openMinutes = open.to - open.from - unionLength(breaks.map((found) => cut(found, open)));
  if (openMinutes <= 0) return null;
  const bookedMinutes = appointments
    .filter((appointment) => !NOT_BOOKED.has(appointment.status))
    .reduce((sum, appointment) => sum + length(cut(appointment, open)), 0);
  return Math.round((bookedMinutes / openMinutes) * 100);
}

/**
 * The hours the grid runs: from the clinic's earliest opening to its latest closing in the week, in
 * whole hours (08:00 to 18:00 when it has no hours), widened to any of the day's blocks outside them,
 * within the day.
 */
export function gridSpan(hours: readonly OpeningHours[], blocks: readonly Span[]): Span {
  const span =
    hours.length === 0
      ? { ...NO_HOURS_GRID }
      : {
          from: floorHour(Math.min(...hours.map((found) => found.opens))),
          to: ceilHour(Math.max(...hours.map((found) => found.closes))),
        };
  for (const block of blocks) {
    span.from = Math.min(span.from, floorHour(Math.max(0, block.from)));
    span.to = Math.max(span.to, ceilHour(Math.min(MINUTES_PER_DAY, block.to)));
  }
  return span;
}

/** The parts of the grid outside the day's hours: the whole grid when the clinic is closed. */
export function outsideHours(open: Span | null, grid: Span): Span[] {
  if (open === null) return [{ ...grid }];
  return [
    { from: grid.from, to: open.from },
    { from: open.to, to: grid.to },
  ].filter((span) => span.to > span.from);
}

/**
 * Lanes for the blocks of one column, by start: blocks that overlap, directly or through others,
 * share the column's width, each in a lane of its own, so each stays readable (D-020: a visit
 * booked anyway, a cancelled one rebooked at its time). A block that ends when another starts does
 * not overlap it. The blocks come back by start, the longer first; blocks of the same span keep
 * their order.
 */
export function placeInLanes<T extends Span>(blocks: readonly T[]): (T & Placed)[] {
  const byStart = [...blocks].sort((a, b) => a.from - b.from || b.to - a.to);
  const placed: (T & Placed)[] = [];
  let group: (T & Placed)[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const closeGroup = () => {
    for (const block of group) block.lanes = laneEnds.length;
    placed.push(...group);
    group = [];
    laneEnds = [];
    groupEnd = -Infinity;
  };
  for (const block of byStart) {
    if (group.length > 0 && block.from >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= block.from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.to);
    } else {
      laneEnds[lane] = block.to;
    }
    group.push({ ...block, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, block.to);
  }
  closeGroup();
  return placed;
}

/** The initials of a name: the first letters of its first and last words, `EP` for Elena Planinska. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== '');
  const ends = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return ends
    .map((word) => Array.from(word ?? '')[0] ?? '')
    .join('')
    .toUpperCase();
}

function cut(span: Span, within: Span): Span {
  return { from: Math.max(span.from, within.from), to: Math.min(span.to, within.to) };
}

function length(span: Span): number {
  return Math.max(0, span.to - span.from);
}

/** The minutes the spans cover together: where two overlap, once. */
function unionLength(spans: readonly Span[]): number {
  let total = 0;
  let end = -Infinity;
  for (const span of [...spans]
    .filter((found) => length(found) > 0)
    .sort((a, b) => a.from - b.from)) {
    if (span.from >= end) {
      total += span.to - span.from;
      end = span.to;
    } else if (span.to > end) {
      total += span.to - end;
      end = span.to;
    }
  }
  return total;
}

function floorHour(minutes: number): number {
  return Math.floor(minutes / 60) * 60;
}

function ceilHour(minutes: number): number {
  return Math.ceil(minutes / 60) * 60;
}
