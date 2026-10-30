import { eq, inArray, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { isCalendarDay, type CalendarDay } from '@/lib/calendar-day';
import { chairClashes, sameVisitHoldsChair } from './chair';
import { appointmentChanged, type AppointmentChangedHook } from './events';
import { startExists, startMoments } from './local-time';
import { movable, type MovableStatus } from './movable';
import { appointments, providers } from './schema';

/** Minutes in a day on the clinic's clock: a start is a local time from 00:00 up to 23:59. */
const MINUTES_PER_DAY = 24 * 60;

/** Where a visit moves to, each value's form checked by the caller's schema. */
export interface AppointmentMove {
  appointmentId: string;
  /** The provider it moves to: the same as now, or another. */
  providerId: string;
  /** The clinic's day it moves to, and its start on it, as the booking's (`NewBooking`). */
  day: CalendarDay;
  startMinute: number;
  /** The clinic's zone (clinicPlace); the database knows it (D-110). */
  timeZone: string;
  /** The person's "anyway" (D-020): a move over a visit that holds the chair is allowed. */
  anyway: boolean;
  /**
   * Whether the patient is an active patient of the clinic: asked of the patients module by the
   * caller (`patients.patientStatus`, which takes the patient's row `for share`), as a restore's is.
   * A moved visit holds the chair at its new time, so only an active patient's is moved (D-113).
   */
  patientIsActive: (patientId: string) => Promise<boolean>;
}

/**
 * What a move can be refused with, as a code and never thrown: nothing is written.
 * - `not_found`: no appointment of the clinic by that id (Row-Level Security shows no other clinic's).
 * - `not_movable`: its status is not booked or confirmed (./movable.ts).
 * - `patient_not_bookable`: the patient is not an active patient of the clinic.
 * - `provider_not_bookable`: no provider of the clinic by that id, or one that is not active.
 * - `start_skipped`: the clocks skip that local time on that day.
 * - `nothing_changed`: the same provider at the same moment.
 * - `already_booked`: the patient already has another visit with that provider at that start that
 *   holds the chair.
 * - `overlap`: another visit of that provider at that time holds the chair, and no "anyway".
 */
export type MoveRefusal =
  | 'not_found'
  | 'not_movable'
  | 'patient_not_bookable'
  | 'provider_not_bookable'
  | 'start_skipped'
  | 'nothing_changed'
  | 'already_booked'
  | 'overlap';

/** What changed, by name and never by value (the audit row's `fields`). */
export type MovedField = 'provider' | 'day' | 'start';

export type MoveResult =
  { ok: true; from: MovableStatus; fields: MovedField[] } | { ok: false; code: MoveRefusal };

/**
 * Moves one visit to another provider, day and/or start in the clinic of the transaction (E01-T06c).
 * Only a booked or a confirmed visit of an active patient moves. Its length stays, in real time: the
 * new end is the new start plus the old end minus the old start, also across a day the clocks change.
 * Its title, treatment, patient and `created_by` stay.
 *
 * It re-checks the chair as a booking does, but the visit being moved is left out of every check, as
 * it holds the chair at its old place (09:00 to 09:15 with the same provider overlaps itself): the
 * start must exist (`start_skipped`), the same patient may not already hold that start with that
 * provider (`already_booked`), and another visit of the provider at that time is an `overlap` unless
 * "anyway", which sets `overlap_ok` exactly when a clash exists as the row is written, and clears it
 * when there is none (data-model.md, "No double booking").
 *
 * What is written, with `updated_at` = `now`: provider, both moments, status `booked`, and
 * `confirmed_at` and `confirmed_via` cleared: the patient confirmed the old time (D-122, "Revisit if").
 *
 * Locks, always in this order (booking takes the provider only and never locks an existing
 * appointment, a restore takes appointment then provider, so no two take them the other way round):
 * the patient's row `for share` (patientIsActive), the appointment `for update`, read again under its
 * lock so two moves of one visit take turns and the second is judged against the first's place, then
 * the old and the new provider's rows `for update` in id order, the same order for every writer
 * (D-122). A wait longer than the lock timeout (5 s, src/db/tenant.ts) fails loudly. The exclusion
 * constraint stays the last guard of a move to an ordinary place.
 *
 * `emit` is called once, after the write, in the same transaction, with `moved` true; a refusal calls
 * nothing. A value the caller's schema should have refused (a day that is no date, a start outside
 * the day) is an Error.
 */
export async function moveAppointment(
  tx: TenantTransaction,
  move: AppointmentMove,
  now: Date,
  emit: AppointmentChangedHook = appointmentChanged,
): Promise<MoveResult> {
  if (
    !isCalendarDay(move.day) ||
    !Number.isInteger(move.startMinute) ||
    move.startMinute < 0 ||
    move.startMinute >= MINUTES_PER_DAY
  ) {
    throw new Error('moveAppointment: the move cannot be stored');
  }

  const [seen] = await tx
    .select({ patientId: appointments.patientId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, move.appointmentId));
  if (!seen) return { ok: false, code: 'not_found' };
  if (!movable(seen.status)) return { ok: false, code: 'not_movable' };
  if (!(await move.patientIsActive(seen.patientId))) {
    return { ok: false, code: 'patient_not_bookable' };
  }

  // Read again under the lock: the status and the place may have changed since the read above.
  const localOld = sql`(${appointments.startsAt} at time zone ${move.timeZone})`;
  const [row] = await tx
    .select({
      patientId: appointments.patientId,
      providerId: appointments.providerId,
      status: appointments.status,
      oldDay: sql<string>`(${localOld}::date)::text`,
      oldMinute: sql<number>`(extract(epoch from (${localOld} - ${localOld}::date::timestamp)) / 60)::float8`,
      lengthSeconds: sql<number>`extract(epoch from (${appointments.endsAt} - ${appointments.startsAt}))::float8`,
    })
    .from(appointments)
    .where(eq(appointments.id, move.appointmentId))
    .for('update');
  if (!row) return { ok: false, code: 'not_found' };
  const from = row.status;
  if (!movable(from)) return { ok: false, code: 'not_movable' };

  // The old and the new provider, in id order whichever way the move goes.
  const held = await tx
    .select({ id: providers.id, active: providers.active })
    .from(providers)
    .where(inArray(providers.id, [row.providerId, move.providerId]))
    .orderBy(providers.id)
    .for('update');
  if (!held.some((provider) => provider.id === move.providerId && provider.active)) {
    return { ok: false, code: 'provider_not_bookable' };
  }

  const moments = startMoments(move.day, move.startMinute, move.timeZone);
  const { startsAt } = moments;
  if (!(await startExists(tx, moments, move.timeZone))) {
    return { ok: false, code: 'start_skipped' };
  }
  const endsAt = sql`(${startsAt} + make_interval(secs => ${row.lengthSeconds}))`;

  // Judged on the moments, with the typed day and start turned into one in SQL.
  const [place] = await tx
    .select({ unchanged: sql<boolean>`${appointments.startsAt} = ${startsAt}` })
    .from(appointments)
    .where(eq(appointments.id, move.appointmentId));
  if (move.providerId === row.providerId && place?.unchanged === true) {
    return { ok: false, code: 'nothing_changed' };
  }

  const visit = { patientId: row.patientId, providerId: move.providerId, startsAt };
  if (await sameVisitHoldsChair(tx, visit, move.appointmentId)) {
    return { ok: false, code: 'already_booked' };
  }
  const clash = await chairClashes(
    tx,
    { providerId: move.providerId, startsAt, endsAt },
    move.appointmentId,
  );
  if (clash && !move.anyway) return { ok: false, code: 'overlap' };

  await tx
    .update(appointments)
    .set({
      providerId: move.providerId,
      startsAt,
      endsAt,
      status: 'booked',
      confirmedAt: null,
      confirmedVia: null,
      // Only over a real overlap, as it is when the row is written (E01-T05b).
      overlapOk: clash,
      updatedAt: now,
    })
    .where(eq(appointments.id, move.appointmentId));
  await emit(tx, { appointmentId: move.appointmentId, from, to: 'booked', at: now, moved: true });

  const fields: MovedField[] = [];
  if (move.providerId !== row.providerId) fields.push('provider');
  if (move.day !== row.oldDay) fields.push('day');
  if (move.startMinute !== row.oldMinute) fields.push('start');
  // The same wall-clock time at another moment: the night summer time ends and the time comes twice.
  if (fields.length === 0) fields.push('start');
  return { ok: true, from, fields };
}
