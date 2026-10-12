import { and, asc, gt, lt, sql, type Column } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';
import { appointments } from './schema';

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
}

/**
 * The appointments that overlap this day of the clinic, of every status, by start: those that end
 * after the day's local midnight in `timeZone` and start before the next one. PostgreSQL turns the
 * day into its two midnights and each moment into its local time (`AT TIME ZONE`), so the computer's
 * zone and the session's play no part. `timeZone` is the clinic's (clinicPlace); the database must
 * know it by that name (D-110).
 */
export async function appointmentsOnDay(
  tx: TenantTransaction,
  day: CalendarDay,
  timeZone: string,
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
      startMinute: minutesFromMidnight(appointments.startsAt),
      endMinute: minutesFromMidnight(appointments.endsAt),
    })
    .from(appointments)
    .where(and(lt(appointments.startsAt, nextDayStarts), gt(appointments.endsAt, dayStarts)))
    .orderBy(asc(appointments.startsAt), asc(appointments.id));
  return rows.map((row) => ({ ...row, status: toStatus(row.status) }));
}

function toStatus(value: string): AppointmentStatus {
  const status = APPOINTMENT_STATUSES.find((known) => known === value);
  if (!status) throw new Error('scheduling: an appointment holds a status the code does not know');
  return status;
}
