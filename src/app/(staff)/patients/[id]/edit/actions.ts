'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';
import * as scheduling from '@/modules/scheduling';
import { patientDetails } from '../../new/patient-fields';

/*
 * Editing a patient (E01-T03b): the edit form sends updatePatient, and asks readVisitsAhead for the
 * visits that stand in the way when an archive is refused. What the input alone settles is shown at
 * its field (the schema is the new-patient page's, ../../new/patient-fields.ts); the phone needs the
 * clinic's country, so its problem is the handler's refusal, shown above the button (D-098).
 */

/**
 * The patient's id is lower-cased, as the profile's read does (E01-T03a, fix round 1): the audit row
 * names the patient by the text of this input, and a later "who changed this patient" must find the
 * row however the address was typed. A transform that never throws.
 */
const patientId = z.uuid().transform((id) => id.toLowerCase());

const editPatient = patientDetails.extend({
  patientId,
  status: z.enum(patients.PATIENT_STATUSES),
});

/**
 * Saves a patient's details and status (patients.manage: every member, scope-v1.md), with one audit
 * row, `patient.updated`, naming the patient and the fields that changed as values of
 * `metadata.fields`, never their values. Refused, with nothing written and no row (the wrapper writes
 * exactly one row for a handler that returns, so a save that changes nothing is a refusal):
 * `not_found` (no patient of the clinic by this id), `phone_impossible`, `nothing_changed`, and
 * `visits_ahead`, for archived or deceased while a visit that holds the chair is ahead (owner, D-114).
 * When it is saved, the patient list and the profile are read again on their next visit, one reached
 * by Back too (revalidatePath). Never redirect() here: the wrapper answers a throw `internal`.
 */
export const updatePatient = staffAction(
  {
    permission: 'patients.manage',
    input: editPatient,
    audit: {
      action: 'patient.updated',
      entityType: 'patient',
      entityId: ({ input }) => input.patientId,
      metadata: { result: 'audit' },
    },
  },
  async ({ input, tx, now }) => {
    const { patientId: id, ...changes } = input;
    const saved = await patients.update(
      tx,
      id,
      changes,
      now,
      async () => (await scheduling.patientVisitsAhead(tx, id, now)).length > 0,
    );
    if (!saved.ok) return refuse(saved.code);
    revalidatePath('/patients');
    revalidatePath(`/patients/${id}`);
    return { id, audit: { fields: saved.fields } };
  },
);

/** One visit that stands in the way, as the edit page lists it: the moment is an ISO string. */
export interface VisitAheadRow {
  id: string;
  startsAt: string;
  what: string;
  providerName: string;
}

/**
 * The visits ahead of a patient that hold the chair (scheduling.patientVisitsAhead), soonest first,
 * for the list above the button when an archive was refused. Every member sees every patient of their
 * clinic (Q-11, D-096). No audit row: the page's own read of the patient wrote the view, and this
 * lists appointments, as the calendar does (D-098). Another clinic's patient has none.
 */
export const readVisitsAhead = staffRead(
  { permission: 'every_member', input: z.object({ patientId: z.uuid() }) },
  async ({ input, tx, now }): Promise<VisitAheadRow[]> =>
    (await scheduling.patientVisitsAhead(tx, input.patientId, now)).map((visit) => ({
      id: visit.id,
      startsAt: visit.startsAt.toISOString(),
      what: visit.what,
      providerName: visit.providerName,
    })),
);
