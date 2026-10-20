'use server';

import { refresh, revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { clinicPlace } from '@/modules/tenancy';
import { LENGTH_MAX, minutesOfStart } from './booking-choices';
import { isShownDay, type CalendarRead } from './day';
import { ownProvider, readDay } from './read-day';

/**
 * The calendar's day (E01-T04a): the page reads it with forPage, the day its address asks for or
 * null for the clinic's today; the calendar reads it again from the browser when it is used, at most
 * once every 30 seconds (E01-T04b, D-108). With it, the provider the reader's membership is linked
 * to, whose column the calendar opens on (E01-T04b), and the clinic's active treatment types, which
 * the new-appointment drawer offers (E01-T05a). Every role has calendar.manage (scope-v1.md,
 * "Navigation and roles"). No audit row: a calendar is a list, not a patient record view (D-098,
 * security-privacy.md section 10).
 */
export const readCalendarDay = staffRead(
  {
    permission: 'calendar.manage',
    input: z.object({ day: z.string().refine(isShownDay).nullable() }),
  },
  async ({ input, tx, staff, now }): Promise<CalendarRead> => ({
    view: await readDay(tx, input.day, now),
    ownProviderId: await ownProvider(tx, staff.user.id),
    treatmentTypes: await scheduling.activeTreatmentTypes(tx),
  }),
);

/*
 * Booking an existing patient from the new-appointment drawer (E01-T05a). What the input alone settles
 * is the schema's, shown at its field (D-098): a patient, a treatment and a provider picked, a start of
 * the day, a length. What needs the clinic's rows is the handler's refusal, shown above Book: a patient
 * who is not active (owner, D-113), a provider or a treatment no longer offered, a start the clocks
 * skip, the same booking again, an overlap without "anyway" (E01-T05b).
 */

const booking = z.object({
  /** The patient picked: the field's hidden value, never the words searched for (D-095). */
  patientId: z.uuid(),
  providerId: z.uuid(),
  treatmentTypeId: z.uuid(),
  /** The day the calendar shows. */
  day: z.string().refine(isShownDay),
  /** `HH:MM`, a local time on that day, as minutes from its local midnight. */
  start: z.string().transform((value, ctx) => {
    const minutes = minutesOfStart(value);
    if (minutes !== null) return minutes;
    ctx.addIssue({ code: 'invalid_format', format: 'start', message: 'start' });
    return z.NEVER;
  }),
  /** In minutes, as the select sends it ("30"), at most a day. */
  length: z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(LENGTH_MAX)),
  /**
   * The person's "anyway" (D-020, E01-T05b): a hidden field the drawer sends only while it shows the
   * overlap, which Book anyway then books. Not sent: an overlap is refused.
   */
  anyway: z
    .literal('true')
    .optional()
    .transform((sent) => sent !== undefined),
});

/**
 * Books the appointment (scheduling.createAppointment), for every member (calendar.manage: the row
 * "Calendar, patients, booking"), with one audit row, appointment.created, of ids only: the
 * appointment's, and the member's as its actor. It refuses, with nothing written, a patient who is not
 * an active patient of the clinic, asked of the patients module (owner, D-113), and whatever the
 * scheduling module refuses. Answers the appointment's id and its provider's, whose column the
 * calendar then shows (E01-T05a).
 *
 * When it is done, the calendar's day comes back in this action's answer (refresh()), so the block is
 * on the grid at once; and every patient list visited before is read again on its next visit, one
 * reached by Back too (revalidatePath): its next visit has changed. Never redirect() here: the
 * wrapper answers a throw `internal`.
 *
 * Refused as an overlap or as the same booking again, the day comes back too (E01-T05b): the visit is
 * one the drawer did not show, booked since the calendar's day was read, and the drawer's warning then
 * names it, with Book anyway one press away. The refusal still writes nothing: refresh() only asks
 * Next.js to send the page again with the answer, and the wrapper rolls the transaction back.
 */
export const bookAppointment = staffAction(
  {
    permission: 'calendar.manage',
    input: booking,
    audit: { action: 'appointment.created', entityType: 'appointment', entityId: { result: 'id' } },
  },
  async ({ input, tx, staff, now }) => {
    if ((await patients.patientStatus(tx, input.patientId)) !== 'active') {
      return refuse('patient_not_bookable');
    }
    const { timeZone } = await clinicPlace(tx);
    const booked = await scheduling.createAppointment(
      tx,
      {
        patientId: input.patientId,
        providerId: input.providerId,
        treatmentTypeId: input.treatmentTypeId,
        day: input.day,
        startMinute: input.start,
        lengthMinutes: input.length,
        timeZone,
        createdBy: staff.user.id,
        anyway: input.anyway,
      },
      now,
    );
    if (!booked.ok) {
      if (booked.code === 'overlap' || booked.code === 'already_booked') refresh();
      return refuse(booked.code);
    }
    refresh();
    revalidatePath('/patients');
    return { id: booked.id, providerId: input.providerId };
  },
);
