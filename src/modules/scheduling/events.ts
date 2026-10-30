import type { TenantTransaction } from '@/db/tenant';
import type { AppointmentStatus } from './appointments';

/**
 * An appointment's status changed (E01-T06a). Ids and statuses only: nothing that identifies a
 * patient, and never the cancel reason.
 */
export interface AppointmentChanged {
  appointmentId: string;
  from: AppointmentStatus;
  to: AppointmentStatus;
  /** The moment of the change: the `now` the caller passed. */
  at: Date;
  /**
   * True when the visit moved to another provider, day or start (E01-T06c); absent for a status
   * change. A moved visit goes back to `booked`: a booked one moved has `from` and `to` both
   * `booked`, so a reader of this event reads the row, which holds the new time (E02-T06).
   */
  moved?: boolean;
}

/** What `changeAppointmentStatus` and `moveAppointment` call once per successful change, in the change's transaction. */
export type AppointmentChangedHook = (
  tx: TenantTransaction,
  event: AppointmentChanged,
) => Promise<void>;

/**
 * The default hook, and today a no-op: E02-T06 gives it a body that writes the planner's job in the
 * same transaction, so a change and the messages it affects stand or fall together. It is called
 * after the change is written and only for a change that succeeds; a hook that throws rolls the
 * change back.
 */
export const appointmentChanged: AppointmentChangedHook = () => Promise.resolve();
