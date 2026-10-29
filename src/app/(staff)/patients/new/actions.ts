'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';
import {
  dateOfBirth,
  EMAIL_MAX,
  NAME_MAX,
  optional,
  patientDetails,
  PHONE_MAX,
} from './patient-fields';

/*
 * Adding a patient (E01-T02b): the new-patient form sends createPatient, and asks
 * findLikelyDuplicates, as a field is left, who the patient being typed may already be. What the
 * input alone settles is checked here and shown at its field (a name missing, an email that is no
 * email, a date that is no date); the phone needs the clinic's country, which only the handler's
 * transaction reads, so its problem is the handler's refusal, shown above the button (D-098). The
 * fields a new patient shares with the booking drawer's quick one are in ./patient-fields.ts
 * (E01-T05d).
 */

/**
 * Adds a patient to the clinic (patients.manage: every member, scope-v1.md), with one audit row,
 * patient.created, that holds ids and codes only. Answers the new id only. An impossible phone is
 * refused as phone_impossible, with nothing written. When it is done, the patient list is read
 * again on its next visit, an earlier copy reached by Back too (revalidatePath; the form then goes
 * to the list). Never redirect() here: the wrapper answers a throw `internal`.
 */
export const createPatient = staffAction(
  {
    permission: 'patients.manage',
    input: patientDetails,
    audit: { action: 'patient.created', entityType: 'patient', entityId: { result: 'id' } },
  },
  async ({ input, tx, now }) => {
    const made = await patients.create(tx, input, now);
    if (!made.ok) return refuse(made.code);
    revalidatePath('/patients');
    return { id: made.id };
  },
);

/** What the form has typed so far, as the check reads it: any text, as nothing is stored. */
const typedPatient = z.object({
  firstName: z.string().max(NAME_MAX),
  lastName: z.string().max(NAME_MAX),
  dateOfBirth,
  phone: optional(z.string().max(PHONE_MAX)),
  email: optional(z.string().max(EMAIL_MAX)),
});

/**
 * The clinic's patients who may be the one being typed, for the warning above the button (D-033):
 * called with the frame's clinic, the typed words in the request's body (D-092, D-095). Every member
 * sees every patient of their clinic (Q-11, D-096). It writes nothing and no audit row: a warning is
 * no record view (security-privacy.md section 10, D-098).
 */
export const findLikelyDuplicates = staffRead(
  { permission: 'every_member', input: typedPatient },
  async ({ input, tx }) => patients.likelyDuplicates(tx, input),
);
