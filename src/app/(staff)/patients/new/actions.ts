'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { refuse, staffAction, staffRead } from '@/app/_lib/actions';
import * as patients from '@/modules/patients';

/*
 * Adding a patient (E01-T02b): the new-patient form sends createPatient, and asks
 * findLikelyDuplicates, as a field is left, who the patient being typed may already be. What the
 * input alone settles is checked here and shown at its field (a name missing, an email that is no
 * email, a date that is no date); the phone needs the clinic's country, which only the handler's
 * transaction reads, so its problem is the handler's refusal, shown above the button (D-098).
 */

/** The longest each field may be, in characters (a guardian's is a full name; RFC 5321's email). */
const NAME_MAX = 100;
const FULL_NAME_MAX = 200;
const PHONE_MAX = 40;
const EMAIL_MAX = 254;
const NOTES_MAX = 2000;

/**
 * A field the form may leave empty: a form sends '' for it, which is none (null), never "Fill this
 * in."; so is blank text, and a field not sent at all.
 */
function optional<S extends z.ZodType>(field: S) {
  return z.preprocess(
    (value) =>
      value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value,
    field.nullable(),
  );
}

/** A first or last name: trimmed, then not empty. */
const name = z.string().trim().min(1).max(NAME_MAX);

/**
 * The browser's date field: a calendar date, YYYY-MM-DD, checked as one (2031-02-30 is none). It
 * sends a date it cannot read, half typed, as '': stored as none, like a field left empty.
 */
const dateOfBirth = optional(z.iso.date());

const newPatient = z.object({
  firstName: name,
  lastName: name,
  dateOfBirth,
  /** As typed: the handler reads it with the clinic's country (patients.create). */
  phone: optional(z.string().trim().max(PHONE_MAX)),
  /** Trimmed and lower-cased, then checked. */
  email: optional(z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email())),
  /** Any two lower-case letters (D-053): the select offers the message file's languages. */
  language: z.string().regex(/^[a-z]{2}$/),
  guardianName: optional(z.string().trim().max(FULL_NAME_MAX)),
  /** Not a clinical record; '' for none. */
  notes: z.string().trim().max(NOTES_MAX),
});

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
    input: newPatient,
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
