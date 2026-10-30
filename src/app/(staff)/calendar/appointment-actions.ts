'use server';

import { refresh, revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { clinicPlace } from '@/modules/tenancy';
import { minutesOfStart } from './booking-choices';
import { isShownDay } from './day';

/*
 * An appointment's status changed from the calendar (E01-T06a; the drawer that calls it is E01-T06b's).
 * What the input alone settles is the schema's: the appointment's id, one of the actions, who cancelled
 * and the reason's length. What needs the clinic's rows is the handler's refusal: no such appointment,
 * a change the state machine does not have, a no-show before the start, a restore that finds the chair
 * taken (scheduling.changeAppointmentStatus).
 */

/**
 * The appointment's id, lower-cased: it is the audit row's `entity_id`, which "who changed this
 * visit" finds by that one spelling (E01-T03a; the wider fix is E01-T12). A transform that never throws.
 */
const appointmentId = z.uuid().transform((id) => id.toLowerCase());

const change = z.discriminatedUnion('action', [
  z.object({
    appointmentId,
    action: z.enum(['confirm', 'arrive', 'complete', 'no_show', 'undo_arrival', 'undo_completion']),
  }),
  z.object({
    appointmentId,
    action: z.literal('cancel'),
    /** Who cancelled: the desk records a patient's call as `patient` (E01-T06b's dialog asks). */
    cancelledBy: z.enum(['staff', 'patient']),
    /** Trimmed, at most CANCEL_REASON_MAX characters; absent or empty: none. Never audited or logged. */
    reason: z
      .string()
      .trim()
      .max(scheduling.CANCEL_REASON_MAX)
      .optional()
      .transform((reason) => (reason === undefined || reason === '' ? null : reason)),
  }),
  z.object({
    appointmentId,
    action: z.literal('restore'),
    /** The person's "anyway" (D-020), sent only over the overlap the drawer showed. */
    anyway: z.boolean().default(false),
  }),
]);

/**
 * Changes the appointment's status (scheduling.changeAppointmentStatus), for every member
 * (calendar.manage: the row "Calendar, patients, booking"), with one audit row,
 * appointment.status_changed, of the appointment's id and the metadata `{ fromStatus, toStatus }`: the
 * two statuses, never the cancel reason. (Not `from` and `to`: the audit log refuses those names,
 * personal fields of a message, src/lib/personal-fields.ts.) Refused, with nothing written and no audit row, as the module
 * refuses: not_found, not_allowed, too_early, overlap, already_booked, provider_not_bookable,
 * patient_not_bookable. Answers the two statuses.
 *
 * When it is done, the calendar's day comes back in this action's answer (refresh()), and every
 * patient list visited before is read again on its next visit (revalidatePath): its next visit has
 * changed. A restore refused as an overlap or as the same visit again brings the day too, as a
 * booking does (E01-T05b): the visit that blocks it is new to the caller. Never redirect() here:
 * the wrapper answers a throw `internal`.
 */
export const changeAppointmentStatus = staffAction(
  {
    permission: 'calendar.manage',
    input: change,
    audit: {
      action: 'appointment.status_changed',
      entityType: 'appointment',
      entityId: ({ input }) => input.appointmentId,
      metadata: { result: 'audit' },
    },
  },
  async ({ input, tx, now }) => {
    const { timeZone } = await clinicPlace(tx);
    const common = { appointmentId: input.appointmentId, actor: 'staff', timeZone } as const;
    let request: scheduling.StatusChange;
    switch (input.action) {
      case 'cancel':
        request = {
          ...common,
          action: 'cancel',
          cancelledBy: input.cancelledBy,
          reason: input.reason,
        };
        break;
      case 'restore':
        request = {
          ...common,
          action: 'restore',
          anyway: input.anyway,
          patientIsActive: async (patientId) =>
            (await patients.patientStatus(tx, patientId)) === 'active',
        };
        break;
      default:
        request = { ...common, action: input.action };
    }
    const done = await scheduling.changeAppointmentStatus(tx, request, now);
    if (!done.ok) {
      if (done.code === 'overlap' || done.code === 'already_booked') refresh();
      return refuse(done.code);
    }
    refresh();
    revalidatePath('/patients');
    return {
      from: done.from,
      to: done.to,
      audit: { fromStatus: done.from, toStatus: done.to },
    };
  },
);

/**
 * Where a visit moves to (E01-T06c; the drawer's form is E01-T06f's). The schema settles what the input
 * alone does: the appointment's id, the provider's, a day the calendar shows and a start of it, as the
 * booking's. What needs the clinic's rows is the handler's refusal (scheduling.moveAppointment).
 */
const move = z.object({
  appointmentId,
  providerId: z.uuid(),
  /** The day the visit moves to. */
  day: z.string().refine(isShownDay),
  /** `HH:MM`, a local time on that day, as minutes from its local midnight (a bad one: invalid_input at "start"). */
  start: z.string().transform((value, ctx) => {
    const minutes = minutesOfStart(value);
    if (minutes !== null) return minutes;
    ctx.addIssue({ code: 'invalid_format', format: 'start', message: 'start' });
    return z.NEVER;
  }),
  /**
   * The person's "anyway" (D-020), a hidden field sent only while the form shows the overlap, which
   * Move anyway then moves over. Not sent: an overlap is refused.
   */
  anyway: z
    .literal('true')
    .optional()
    .transform((sent) => sent !== undefined),
});

/**
 * Moves the visit (scheduling.moveAppointment), for every member (calendar.manage: the row "Calendar,
 * patients, booking"), with one audit row, appointment.moved, of the appointment's id and the metadata
 * `{ fromStatus, toStatus, fields }`: the two statuses, and the names that changed (provider, day,
 * start), never a value or another id. A moved visit is booked again, so `toStatus` is booked. Refused,
 * with nothing written and no audit row, as the module refuses: not_found, not_movable,
 * patient_not_bookable, provider_not_bookable, start_skipped, nothing_changed, already_booked, overlap.
 * Answers the day and the provider it moved to, whose column the calendar then shows.
 *
 * When it is done, the calendar's day comes back in this action's answer (refresh()), and every
 * patient list visited before is read again on its next visit (revalidatePath): its next visit has
 * changed. Refused as an overlap or as the same visit again the day comes back too, as a booking does
 * (E01-T05b): the visit that blocks it is new to the caller. Never redirect() here: the wrapper
 * answers a throw `internal`.
 */
export const moveAppointment = staffAction(
  {
    permission: 'calendar.manage',
    input: move,
    audit: {
      action: 'appointment.moved',
      entityType: 'appointment',
      entityId: ({ input }) => input.appointmentId,
      metadata: { result: 'audit' },
    },
  },
  async ({ input, tx, now }) => {
    const { timeZone } = await clinicPlace(tx);
    const moved = await scheduling.moveAppointment(
      tx,
      {
        appointmentId: input.appointmentId,
        providerId: input.providerId,
        day: input.day,
        startMinute: input.start,
        timeZone,
        anyway: input.anyway,
        patientIsActive: async (patientId) =>
          (await patients.patientStatus(tx, patientId)) === 'active',
      },
      now,
    );
    if (!moved.ok) {
      if (moved.code === 'overlap' || moved.code === 'already_booked') refresh();
      return refuse(moved.code);
    }
    refresh();
    revalidatePath('/patients');
    return {
      day: input.day,
      providerId: input.providerId,
      audit: { fromStatus: moved.from, toStatus: 'booked', fields: moved.fields },
    };
  },
);
