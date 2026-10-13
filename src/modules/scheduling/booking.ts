import { and, eq, gt, lt, notInArray, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { isCalendarDay, type CalendarDay } from '@/lib/calendar-day';
import { newId } from '@/lib/ids';
import type { AppointmentStatus } from './appointments';
import { appointments, providers, treatmentTypes } from './schema';

/** Minutes in a day on the clinic's clock: a start is a local time from 00:00 up to 23:59. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * The statuses whose visits no longer hold the chair: no booking is refused for one (data-model.md,
 * "No double booking").
 */
const CHAIR_FREED = ['cancelled', 'no_show'] satisfies AppointmentStatus[];

/** One appointment as the desk books it (E01-T05a), each value's form checked by the caller's schema. */
export interface NewBooking {
  /** A patient of the clinic who is active: the caller asks the patients module (owner, D-113). */
  patientId: string;
  providerId: string;
  treatmentTypeId: string;
  /** The clinic's day it is booked on, as the calendar shows it. */
  day: CalendarDay;
  /**
   * Its start, a local time on that day: minutes from the day's local midnight on the clinic's clock,
   * as the calendar places its blocks (540 is 09:00, on a day of 23 or 25 hours too).
   */
  startMinute: number;
  /** How long it lasts, in minutes of real time. */
  lengthMinutes: number;
  /** The clinic's zone (clinicPlace), as appointmentsOnDay takes it; the database knows it (D-110). */
  timeZone: string;
  /** The user who books it. */
  createdBy: string;
}

/**
 * The desk's mistakes and what changed meanwhile, answered as a code and never thrown: the action
 * refuses with it, and nothing is written.
 * - `provider_not_bookable`: no provider of the clinic by that id, or one that is not active.
 * - `treatment_not_bookable`: no treatment type of the clinic by that id, or one that is not active.
 * - `start_skipped`: the clocks skip that local time on that day (the night summer time starts).
 * - `overlap`: another visit of the provider at that time that holds the chair.
 */
export type BookingRefusal =
  'provider_not_bookable' | 'treatment_not_bookable' | 'start_skipped' | 'overlap';

export type BookingResult = { ok: true; id: string } | { ok: false; code: BookingRefusal };

/**
 * Books one appointment in the clinic of the transaction (E01-T05a, the scheduling module's first
 * write): the treatment type's name is its title; status `booked`, source `staff`, `overlap_ok`
 * false, `created_by` the user who books it, both moments of the row `now`.
 *
 * Its start is the local time on the clinic's day, in its zone: PostgreSQL turns the day's local
 * midnight plus the minutes into a moment (`AT TIME ZONE`), so 09:00 is 09:00 on the days the clocks
 * change too. A local time the clocks skip has no moment: refused as `start_skipped`, never stored
 * an hour later, as PostgreSQL would read it. A local time that comes twice (the night summer time
 * ends) is the second, in standard time, as PostgreSQL reads it. It ends `lengthMinutes` of real time
 * later.
 *
 * Refused, with nothing written: a provider or a treatment type that is not active or not the
 * clinic's (Row-Level Security shows no other clinic's), and a time that overlaps another visit of
 * the provider that holds the chair: of every status but cancelled and no-show, one booked anyway
 * (`overlap_ok`) too, which the database's own constraint lets through. A visit that ends when this
 * one starts, or starts when it ends, does not overlap it.
 *
 * Two bookings of one provider at once take turns: the provider's row is locked first, so the
 * second waits until the first is committed or rolled back, then sees its visit and is refused as an
 * overlap. A wait longer than the lock timeout (5 s, src/db/tenant.ts) fails loudly. The exclusion
 * constraint `appointments_no_double_booking` stays the last guard: a writer that skips the lock and
 * overlaps fails it, loudly.
 *
 * A value the caller's schema should have refused is an Error: a day that is no date of the
 * calendar, a start outside the day, a length that is not a whole number of minutes above 0.
 */
export async function createAppointment(
  tx: TenantTransaction,
  booking: NewBooking,
  now: Date,
): Promise<BookingResult> {
  if (!isBookable(booking)) throw new Error('createAppointment: the booking cannot be stored');
  const [provider] = await tx
    .select({ active: providers.active })
    .from(providers)
    .where(eq(providers.id, booking.providerId))
    .for('update');
  if (!provider?.active) return { ok: false, code: 'provider_not_bookable' };
  const [treatment] = await tx
    .select({ name: treatmentTypes.name, active: treatmentTypes.active })
    .from(treatmentTypes)
    .where(eq(treatmentTypes.id, booking.treatmentTypeId));
  if (!treatment?.active) return { ok: false, code: 'treatment_not_bookable' };

  // The moments stay in SQL, from the overlap check to the insert: PostgreSQL alone turns the local
  // time into one, so no moment is read back and parsed here.
  const localStart = sql`(${booking.day}::date::timestamp + make_interval(mins => ${booking.startMinute}))`;
  const startsAt = sql`(${localStart} at time zone ${booking.timeZone})`;
  const endsAt = sql`(${startsAt} + make_interval(mins => ${booking.lengthMinutes}))`;
  const checked = await tx.execute<{ on_its_day: boolean }>(
    sql`select (${startsAt} at time zone ${booking.timeZone}) = ${localStart} as on_its_day`,
  );
  if (checked.rows[0]?.on_its_day !== true) return { ok: false, code: 'start_skipped' };

  const [clash] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.providerId, booking.providerId),
        notInArray(appointments.status, CHAIR_FREED),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
      ),
    )
    .limit(1);
  if (clash) return { ok: false, code: 'overlap' };

  const id = newId();
  await tx.insert(appointments).values({
    id,
    clinicId: sql`current_clinic_id()`,
    patientId: booking.patientId,
    providerId: booking.providerId,
    treatmentTypeId: booking.treatmentTypeId,
    title: treatment.name,
    startsAt,
    endsAt,
    status: 'booked',
    overlapOk: false,
    source: 'staff',
    createdBy: booking.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, id };
}

/** True for a booking a row can hold: a day, a start on it, a whole length above 0. */
function isBookable({ day, startMinute, lengthMinutes }: NewBooking): boolean {
  return (
    isCalendarDay(day) &&
    Number.isInteger(startMinute) &&
    startMinute >= 0 &&
    startMinute < MINUTES_PER_DAY &&
    Number.isInteger(lengthMinutes) &&
    lengthMinutes > 0
  );
}
