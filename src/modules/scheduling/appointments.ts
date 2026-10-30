import { and, asc, gt, lt, sql, type Column } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';
import { movable } from './movable';
import { appointments } from './schema';
import { allowedActions, statusFactsOf, type StatusAction } from './status-machine';

/** An appointment's statuses (D-018); "No reply yet" is derived, not stored (E02-T12). */
export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'arrived',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** An appointment as the calendar places it on a day. */
export interface DayAppointment {
  id: string;
  providerId: string;
  patientId: string;
  /** The label on the calendar ("Filling 36"). */
  title: string;
  status: AppointmentStatus;
  /** Staff's note, '' when there is none. */
  note: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * Minutes from the day's local midnight to its start, on the clinic's clock in its zone: 540 is
   * 09:00, on a day of 23 or 25 hours too. Negative when it began the day before.
   */
  startMinute: number;
  /** Minutes from the day's local midnight to its end: past 1440 when it ends the next day. */
  endMinute: number;
  /**
   * What the desk may do to it at the `now` of the read: the actions the state machine allows for a
   * staff actor (allowedActions), from the same facts the change uses. The calendar's buttons.
   */
  actions: StatusAction[];
  /**
   * Whether the desk can move it (E01-T06c): from the one function the move itself checks
   * (./movable.ts), so the drawer never works it out.
   */
  movable: boolean;
}

/**
 * The appointments that overlap this day of the clinic, of every status, by start: those that end
 * after the day's local midnight in `timeZone` and start before the next one. PostgreSQL turns the
 * day into its two midnights and each moment into its local time (`AT TIME ZONE`), so the computer's
 * zone and the session's play no part. `timeZone` is the clinic's (clinicPlace); the database must
 * know it by that name (D-110).
 *
 * `now` is the moment of the read: each appointment's `actions` are those the state machine allows
 * then (E01-T06b). The confirmation's and the completion's moments are read for that and not returned.
 */
export async function appointmentsOnDay(
  tx: TenantTransaction,
  day: CalendarDay,
  timeZone: string,
  now: Date,
): Promise<DayAppointment[]> {
  const midnight = sql`${day}::date::timestamp`;
  const dayStarts = sql`(${midnight} at time zone ${timeZone})`;
  const nextDayStarts = sql`((${day}::date + 1)::timestamp at time zone ${timeZone})`;
  const minutesFromMidnight = (moment: Column) =>
    sql<number>`(extract(epoch from ((${moment} at time zone ${timeZone}) - ${midnight})) / 60)::float8`;
  const rows = await tx
    .select({
      id: appointments.id,
      providerId: appointments.providerId,
      patientId: appointments.patientId,
      title: appointments.title,
      status: appointments.status,
      note: appointments.note,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      confirmedAt: appointments.confirmedAt,
      completedAt: appointments.completedAt,
      startMinute: minutesFromMidnight(appointments.startsAt),
      endMinute: minutesFromMidnight(appointments.endsAt),
    })
    .from(appointments)
    .where(and(lt(appointments.startsAt, nextDayStarts), gt(appointments.endsAt, dayStarts)))
    .orderBy(asc(appointments.startsAt), asc(appointments.id));
  return rows.map(({ confirmedAt, completedAt, ...row }) => {
    const status = toStatus(row.status);
    const facts = statusFactsOf(
      { startsAt: row.startsAt, confirmedAt, completedAt },
      now,
      timeZone,
    );
    return { ...row, status, actions: allowedActions(status, facts), movable: movable(status) };
  });
}

function toStatus(value: string): AppointmentStatus {
  const status = APPOINTMENT_STATUSES.find((known) => known === value);
  if (!status) throw new Error('scheduling: an appointment holds a status the code does not know');
  return status;
}
