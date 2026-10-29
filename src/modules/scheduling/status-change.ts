import { eq } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { dayInZone } from '@/lib/calendar-day';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './appointments';
import { chairClashes, sameVisitHoldsChair } from './chair';
import { appointmentChanged, type AppointmentChangedHook } from './events';
import { appointments, providers } from './schema';
import {
  nextAppointmentStatus,
  type StatusActor,
  type StatusFacts,
  type StatusRefusal,
} from './status-machine';

/** The longest cancel reason kept, in characters, after it is trimmed. */
export const CANCEL_REASON_MAX = 200;

/** Fields every change has. */
interface ChangeOf {
  appointmentId: string;
  /** Who does it. A patient's own change is E02-T09's; the desk's action passes `staff`. */
  actor: StatusActor;
  /** The clinic's zone (clinicPlace): "the same day" of an undone completion is the clinic's day. */
  timeZone: string;
  /** "Now" is before the clinic's cut-off for a patient's cancel; only that reads it. */
  beforeCutoff?: boolean;
}

/**
 * One change of an appointment's status, as the action or a patient's link asks for it. Each action
 * brings what only it needs: a cancel who cancelled and why, a restore whether to book over an
 * overlap and how to ask if the patient is still active.
 */
export type StatusChange = ChangeOf &
  (
    | {
        action: 'confirm' | 'arrive' | 'complete' | 'no_show' | 'undo_arrival' | 'undo_completion';
      }
    | {
        action: 'cancel';
        /** Who cancelled: the desk records a patient's call as `patient`. */
        cancelledBy: 'staff' | 'patient';
        /**
         * The reason as written: trimmed here, empty kept as null, at most CANCEL_REASON_MAX
         * characters. It lives in the row only: never in an audit row or a log.
         */
        reason: string | null;
      }
    | {
        action: 'restore';
        /** The person's "anyway" (D-020): a restore over a visit that holds the chair is allowed. */
        anyway: boolean;
        /**
         * Whether the patient is an active patient of the clinic: asked of the patients module by
         * the caller (`patients.patientStatus`, which takes the patient's row `for share`), as
         * `patients.update` is given `hasVisitAhead`: scheduling imports no other module.
         */
        patientIsActive: (patientId: string) => Promise<boolean>;
      }
  );

/**
 * What a change can be refused with, as a code and never thrown: nothing is written.
 * - `not_found`: no appointment of the clinic by that id (Row-Level Security shows no other clinic's).
 * - `not_allowed`, `too_early`: the state machine's (status-machine.ts).
 * - `patient_not_bookable`: a restore of a visit of a patient who is not active: a restored visit
 *   holds the chair (D-113, D-114).
 * - `provider_not_bookable`: a restore with a provider who is not active.
 * - `already_booked`: a restore of a visit the patient already has again with the provider at that
 *   start, holding the chair.
 * - `overlap`: a restore over another visit that holds the chair, without "anyway".
 */
export type StatusChangeRefusal =
  | StatusRefusal
  | 'not_found'
  | 'patient_not_bookable'
  | 'provider_not_bookable'
  | 'already_booked'
  | 'overlap';

export type StatusChangeResult =
  | { ok: true; from: AppointmentStatus; to: AppointmentStatus }
  | { ok: false; code: StatusChangeRefusal };

/**
 * Changes one appointment's status in the clinic of the transaction (E01-T06a): the only writer of
 * `appointments.status`, with nextAppointmentStatus deciding. Row-Level Security shows no other
 * clinic's appointment: `not_found`.
 *
 * Locks, always in this order (booking takes patient and provider and never locks an existing
 * appointment, so no two take them the other way round): for a restore the patient's row `for share`
 * (the caller's patientIsActive), then the appointment `for update`, then for a restore the
 * provider's row `for update`. The appointment is read again under its lock, so two changes of one
 * visit at once take turns: the second sees the first's status and is `not_allowed`. A wait longer
 * than the lock timeout (5 s, src/db/tenant.ts) fails loudly.
 *
 * A restore asks about the patient before it looks at the visit's status, so a restore of a visit
 * that is not cancelled, of an archived patient, is `patient_not_bookable`, not `not_allowed`.
 *
 * What is written, with `updated_at` = `now` always:
 * - confirm: `confirmed_at` = now, `confirmed_via` = staff (link for a patient).
 * - complete: `completed_at` = now. undo_arrival and undo_completion clear it.
 * - cancel: `cancelled_at` = now, `cancelled_by`, `cancel_reason` (trimmed, empty as null).
 * - restore: the three cancel columns and `confirmed_at`, `confirmed_via` cleared (the patient
 *   confirmed the old time; D-122), booked again. It re-checks the chair as a booking does: the
 *   provider must be active, the same visit may not already hold it, and a clash with another visit
 *   is `overlap` unless "anyway", which sets `overlap_ok` exactly when a clash exists as the row is
 *   written (data-model.md, "No double booking").
 *
 * `emit` is called once, after the write, in the same transaction, with the ids and the statuses; a
 * refusal calls nothing. The default does nothing until E02-T06.
 *
 * A reason longer than CANCEL_REASON_MAX is an Error: the caller's schema should have refused it.
 */
export async function changeAppointmentStatus(
  tx: TenantTransaction,
  change: StatusChange,
  now: Date,
  emit: AppointmentChangedHook = appointmentChanged,
): Promise<StatusChangeResult> {
  const reason = change.action === 'cancel' ? cancelReason(change.reason) : null;

  const [seen] = await tx
    .select({ patientId: appointments.patientId })
    .from(appointments)
    .where(eq(appointments.id, change.appointmentId));
  if (!seen) return { ok: false, code: 'not_found' };
  if (change.action === 'restore' && !(await change.patientIsActive(seen.patientId))) {
    return { ok: false, code: 'patient_not_bookable' };
  }

  const [row] = await tx
    .select()
    .from(appointments)
    .where(eq(appointments.id, change.appointmentId))
    .for('update');
  if (!row) return { ok: false, code: 'not_found' };
  const from = APPOINTMENT_STATUSES.find((known) => known === row.status);
  if (!from) throw new Error('scheduling: a row holds a status the code does not know');

  const facts: StatusFacts = {
    started: row.startsAt.getTime() <= now.getTime(),
    confirmed: row.confirmedAt !== null,
    sameDay:
      row.completedAt !== null &&
      dayInZone(row.completedAt, change.timeZone) === dayInZone(now, change.timeZone),
    // No aftercare exists before E06 (the visit wrap-up): E06 reads whether one was sent.
    aftercareSent: false,
    beforeCutoff: change.beforeCutoff ?? false,
  };
  const next = nextAppointmentStatus(from, change.action, change.actor, facts);
  if (!next.ok) return next;
  const to = next.to;

  let set: Partial<typeof appointments.$inferInsert> = { status: to, updatedAt: now };
  switch (change.action) {
    case 'confirm':
      set = {
        ...set,
        confirmedAt: now,
        confirmedVia: change.actor === 'staff' ? 'staff' : 'link',
      };
      break;
    case 'complete':
      set = { ...set, completedAt: now };
      break;
    case 'undo_arrival':
    case 'undo_completion':
      set = { ...set, completedAt: null };
      break;
    case 'cancel':
      set = { ...set, cancelledAt: now, cancelledBy: change.cancelledBy, cancelReason: reason };
      break;
    case 'restore': {
      // The provider's row first, as a booking does: a restore and a booking of the same slot take
      // turns, and the second sees the first's visit.
      const [provider] = await tx
        .select({ active: providers.active })
        .from(providers)
        .where(eq(providers.id, row.providerId))
        .for('update');
      if (!provider?.active) return { ok: false, code: 'provider_not_bookable' };
      const same = await sameVisitHoldsChair(tx, {
        patientId: row.patientId,
        providerId: row.providerId,
        startsAt: row.startsAt,
      });
      if (same) return { ok: false, code: 'already_booked' };
      const clash = await chairClashes(tx, {
        providerId: row.providerId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      });
      if (clash && !change.anyway) return { ok: false, code: 'overlap' };
      set = {
        ...set,
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        confirmedAt: null,
        confirmedVia: null,
        // Only over a real overlap, as it is when the row is written (E01-T05b).
        overlapOk: clash,
      };
      break;
    }
    case 'arrive':
    case 'no_show':
      break;
  }

  await tx.update(appointments).set(set).where(eq(appointments.id, row.id));
  await emit(tx, { appointmentId: row.id, from, to, at: now });
  return { ok: true, from, to };
}

/** The reason as it is stored: trimmed, empty as null. */
function cancelReason(reason: string | null): string | null {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length > CANCEL_REASON_MAX) {
    throw new Error('changeAppointmentStatus: the cancel reason is too long');
  }
  return trimmed === '' ? null : trimmed;
}
