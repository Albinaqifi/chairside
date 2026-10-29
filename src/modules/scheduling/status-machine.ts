import type { AppointmentStatus } from './appointments';

/**
 * What can be done to an appointment's status (data-model.md, "Appointment state machine"; D-018).
 * `undo_arrival` takes an arrived visit back, `undo_completion` a completed one, `restore` a
 * cancelled or no-show one.
 */
export const STATUS_ACTIONS = [
  'confirm',
  'arrive',
  'complete',
  'no_show',
  'cancel',
  'undo_arrival',
  'undo_completion',
  'restore',
] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

/** Who does it: the desk, or the patient from their link (E02-T09 calls the module as `patient`). */
export type StatusActor = 'staff' | 'patient';

/** What the machine needs to know about the visit and the moment besides its status. */
export interface StatusFacts {
  /** The visit's start is not after "now" (`startsAt <= now`): a no-show is set only after it. */
  started: boolean;
  /** `confirmed_at` is set: an undone arrival returns to confirmed, else to booked. */
  confirmed: boolean;
  /** The visit was completed on the clinic's day it is now: an undone completion is the same day's. */
  sameDay: boolean;
  /** An aftercare message was sent for the visit: false until E06. */
  aftercareSent: boolean;
  /** "Now" is before the clinic's cut-off for a patient's own cancel (a clinic setting, E02). */
  beforeCutoff: boolean;
}

/**
 * `not_allowed`: the table has no such change (a status, an actor or a fact the change needs is
 * wrong). `too_early`: a no-show before the visit's start.
 */
export type StatusRefusal = 'not_allowed' | 'too_early';

export type NextStatus = { ok: true; to: AppointmentStatus } | { ok: false; code: StatusRefusal };

const OPEN: AppointmentStatus[] = ['booked', 'confirmed'];

/**
 * The one function that decides every change of an appointment's status (E01-T06a): nothing else
 * writes `appointments.status`. It is the table of data-model.md, exactly; anything else is
 * `not_allowed`:
 *
 * - confirm: booked to confirmed (staff or patient)
 * - arrive: booked or confirmed to arrived (staff)
 * - cancel: booked or confirmed to cancelled (staff; the patient only before the cut-off)
 * - no_show: booked or confirmed to no_show (staff, only once the visit has started: `too_early`)
 * - complete: booked, confirmed or arrived to completed (staff)
 * - undo_arrival: arrived to confirmed if it was confirmed, else to booked (staff)
 * - restore: cancelled or no_show to booked (staff; the caller re-checks the chair)
 * - undo_completion: completed to arrived (staff, the same day, while no aftercare was sent)
 *
 * A patient may only `confirm` and `cancel`. Pure: no clock (the caller says `started` from its
 * own `now`), no database.
 */
export function nextAppointmentStatus(
  current: AppointmentStatus,
  action: StatusAction,
  actor: StatusActor,
  facts: StatusFacts,
): NextStatus {
  const allowed = (to: AppointmentStatus): NextStatus => ({ ok: true, to });
  const refused: NextStatus = { ok: false, code: 'not_allowed' };
  const staff = actor === 'staff';
  switch (action) {
    case 'confirm':
      return current === 'booked' ? allowed('confirmed') : refused;
    case 'cancel':
      if (!OPEN.includes(current)) return refused;
      return staff || facts.beforeCutoff ? allowed('cancelled') : refused;
    case 'arrive':
      return staff && OPEN.includes(current) ? allowed('arrived') : refused;
    case 'no_show':
      if (!staff || !OPEN.includes(current)) return refused;
      return facts.started ? allowed('no_show') : { ok: false, code: 'too_early' };
    case 'complete':
      return staff && (OPEN.includes(current) || current === 'arrived')
        ? allowed('completed')
        : refused;
    case 'undo_arrival':
      if (!staff || current !== 'arrived') return refused;
      return allowed(facts.confirmed ? 'confirmed' : 'booked');
    case 'restore':
      return staff && (current === 'cancelled' || current === 'no_show')
        ? allowed('booked')
        : refused;
    case 'undo_completion':
      return staff && current === 'completed' && facts.sameDay && !facts.aftercareSent
        ? allowed('arrived')
        : refused;
  }
}
