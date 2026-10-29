import { z } from 'zod';
import messages from '@/i18n/en.json';

/*
 * A new patient's fields as the forms that add one check them (E01-T02b): the new-patient page's
 * (./actions.ts) and the booking drawer's quick new patient (../../calendar/actions.ts, E01-T05d),
 * so both refuse the same input at the same field. A plain file: an actions file ('use server')
 * exports nothing but actions and types (module rule 5).
 */

/** The longest each field may be, in characters (a guardian's is a full name; RFC 5321's email). */
export const NAME_MAX = 100;
export const FULL_NAME_MAX = 200;
export const PHONE_MAX = 40;
export const EMAIL_MAX = 254;
export const NOTES_MAX = 2000;

/**
 * A field the form may leave empty: a form sends '' for it, which is none (null), never "Fill this
 * in."; so is blank text, and a field not sent at all.
 */
export function optional<S extends z.ZodType>(field: S) {
  return z.preprocess(
    (value) =>
      value === undefined || (typeof value === 'string' && value.trim() === '') ? null : value,
    field.nullable(),
  );
}

/** A first or last name: trimmed, then not empty. */
export const name = z.string().trim().min(1).max(NAME_MAX);

/** As typed, or none: the handler reads it with the clinic's country (patients.create). */
export const phone = optional(z.string().trim().max(PHONE_MAX));

/**
 * The language a patient added without one starts on (the booking drawer's quick new patient): the
 * message file's first, where the new-patient page's select starts (D-053); changed on the profile
 * (E01-T03). The file always names one ('en'), which the fallback only spells out for the types.
 */
export const FIRST_LANGUAGE: string = Object.keys(messages.languages)[0] ?? 'en';

/** Trimmed and lower-cased, then checked; or none. */
export const email = optional(z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email()));

/**
 * The browser's date field: a calendar date, YYYY-MM-DD, checked as one (2031-02-30 is none). It
 * sends a date it cannot read, half typed, as '': stored as none, like a field left empty.
 */
export const dateOfBirth = optional(z.iso.date());

/**
 * What the new-patient page and the edit page both send for a patient (E01-T03b): the details,
 * checked once, so both refuse the same input at the same field. What the input alone settles is
 * shown at its field; the phone needs the clinic's country, which only the handler's transaction
 * reads, so its problem is the handler's refusal (D-098).
 */
export const patientDetails = z.object({
  firstName: name,
  lastName: name,
  dateOfBirth,
  phone,
  email,
  /** Any two lower-case letters (D-053): the select offers the message file's languages. */
  language: z.string().regex(/^[a-z]{2}$/),
  guardianName: optional(z.string().trim().max(FULL_NAME_MAX)),
  /** Not a clinical record; '' for none. */
  notes: z.string().trim().max(NOTES_MAX),
});
