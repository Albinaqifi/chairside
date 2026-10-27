'use server';

import { refresh, revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as audit from '@/modules/audit';
import { can } from '@/modules/auth';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { clinicPlace } from '@/modules/tenancy';
import { membershipExtras } from '../navigation';
import { email, FIRST_LANGUAGE, name, phone } from '../patients/new/patient-fields';
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
 * Booking an existing patient from the new-appointment drawer (E01-T05a), or a new one (E01-T05d). What
 * the input alone settles is the schema's, shown at its field (D-098): a patient picked or a new one's
 * names, a treatment and a provider picked, a start of the day, a length. What needs the clinic's rows
 * is the handler's refusal, shown above Book: a patient who is not active (owner, D-113), a new
 * patient's impossible phone, a provider or a treatment no longer offered, a start the clocks skip,
 * the same booking again, an overlap without "anyway" (E01-T05b).
 */

/*
 * The patient is either the one picked or a new one (E01-T05d), never both: the drawer sends the
 * picked patient's id, or the new patient's id it made and their fields, which are checked as the
 * new-patient page checks them, each shown at its field (./patients/new/patient-fields.ts). The
 * transform below takes one of the two, or says which field is wrong.
 */
const bookingFields = z.object({
  /** The patient picked: the field's hidden value, never the words searched for (D-095). */
  patientId: z.uuid().optional(),
  /** The new patient's id, made by the drawer once per opening (E01-T05d). */
  newPatientId: z.uuid().optional(),
  firstName: name.optional(),
  lastName: name.optional(),
  /** Absent or blank: none (null). */
  phone,
  email,
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

/** Whom the booking is for: the patient picked, or a new one with their fields. */
export type BookedPatient =
  | { kind: 'picked'; id: string }
  | {
      kind: 'new';
      id: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      email: string | null;
    };

const booking = bookingFields.transform((fields, ctx) => {
  const { patientId, newPatientId, firstName, lastName, phone, email, ...rest } = fields;
  const wrong = (field: string) => {
    ctx.addIssue({ code: 'custom', path: [field], message: field });
    return z.NEVER;
  };
  if (newPatientId === undefined) {
    // The picked patient alone: a new patient's field beside them is no booking the drawer sends.
    if (patientId === undefined) return wrong('patientId');
    if (firstName !== undefined || lastName !== undefined || phone !== null || email !== null) {
      return wrong('patientId');
    }
    const patient: BookedPatient = { kind: 'picked', id: patientId };
    return { ...rest, patient };
  }
  if (patientId !== undefined) return wrong('newPatientId');
  if (firstName === undefined) return wrong('firstName');
  if (lastName === undefined) return wrong('lastName');
  const patient: BookedPatient = {
    kind: 'new',
    id: newPatientId,
    firstName,
    lastName,
    phone,
    email,
  };
  return { ...rest, patient };
});

/**
 * Books the appointment (scheduling.createAppointment), for every member (calendar.manage: the row
 * "Calendar, patients, booking"), with one audit row, appointment.created, of ids only: the
 * appointment's, and the member's as its actor. It refuses, with nothing written, a patient who is not
 * an active patient of the clinic, asked of the patients module (owner, D-113), and whatever the
 * scheduling module refuses. Answers the appointment's id and its provider's, whose column the
 * calendar then shows (E01-T05a).
 *
 * A new patient (E01-T05d) is added first, in the same transaction, through patients.create (the
 * phone read with the clinic's country: phone_impossible, shown above Book, D-098), with a second
 * audit row of ids, patient.created, which the handler writes as the wrapper writes its own (the
 * member as actor, the action's now, no metadata, as the new-patient page's). A refused booking
 * rolls the patient and that row back with it (refuse()). The drawer's id for the new patient makes
 * the same booking sent twice add them once: the second send finds them and books them as picked,
 * which is then the same booking again, already_booked (test-strategy.md, Duplicates).
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
    const patient = input.patient;
    if (patient.kind === 'new') {
      // Adding a patient is patients.manage's, as the new-patient page's: asked here too, so a
      // narrower role later cannot add patients by booking them. Every role has it today.
      if (!can(staff.clinic.role, membershipExtras(staff.clinic), 'patients.manage')) {
        return refuse('new_patient_forbidden');
      }
      const made = await patients.create(
        tx,
        {
          id: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: null,
          phone: patient.phone,
          email: patient.email,
          language: FIRST_LANGUAGE,
          guardianName: null,
          notes: '',
        },
        now,
      );
      if (!made.ok) return refuse(made.code);
      // A second send of the same booking finds the patient its first added: no second row, and
      // the booking below is then the same booking again, already_booked.
      if (made.created) {
        await audit.record(tx, {
          at: now,
          actorType: 'user',
          actorId: staff.user.id,
          action: 'patient.created',
          entityType: 'patient',
          entityId: made.id,
        });
      }
    }
    // A new patient's id is checked as a picked one's: one that was already there (the first send's,
    // or another clinic's, which Row-Level Security hides) must be an active patient of the clinic.
    if ((await patients.patientStatus(tx, patient.id)) !== 'active') {
      return refuse('patient_not_bookable');
    }
    const { timeZone } = await clinicPlace(tx);
    const booked = await scheduling.createAppointment(
      tx,
      {
        patientId: patient.id,
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
