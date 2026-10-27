/*
 * The booking drawer's quick new patient (E01-T05d, demo line 1335, logic 2120): when the patient
 * field offers "Add “…” as new patient", how the keyboard reaches it, and what the words typed fill
 * in. No React here, so the rules are unit-tested; ./patient-field.tsx and ./new-appointment.tsx
 * show them.
 */

/** From how many characters typed (spaces around them aside) the field offers a new patient. */
export const NEW_PATIENT_FROM = 3;

/**
 * True when the suggestions end with "Add “…” as new patient": three characters typed and no patient
 * picked, whether the search found anyone or not (the demo's `nq.length > 2 && !nf.pid`).
 */
export function offersNewPatient(typed: string, picked: boolean): boolean {
  return !picked && typed.trim().length >= NEW_PATIENT_FROM;
}

/**
 * True when the field shows "Add “…” as new patient" now: it is offered for the text typed
 * (offersNewPatient) and the search for that text has answered with a list, found or not
 * (`answered`: the trimmed text the last answered search was for; null before an answer, or after a
 * failed or `clinic_changed` one). So it always comes with the matches above it, as in the demo,
 * whose search answers at once: never alone while the search is on its way, when ArrowDown and Enter
 * would add a second patient for one the search was about to list (review, E01-T05d).
 */
export function showsNewPatient(typed: string, picked: boolean, answered: string | null): boolean {
  return offersNewPatient(typed, picked) && answered === typed.trim();
}

/**
 * True when Enter takes "Add … as new patient": it is offered and active. It is the last option,
 * after the `suggestionCount` suggestions, so the arrow keys reach it as one of them
 * (./suggestions.ts, moveActive over the suggestions and it).
 */
export function newPatientByEnter(
  suggestionCount: number,
  active: number,
  offered: boolean,
): boolean {
  return offered && active === suggestionCount;
}

/** What the new patient's fields start with. */
export interface NewPatientStart {
  firstName: string;
  lastName: string;
  phone: string;
}

/** A text that reads as a phone searched for (the search takes one, E01-T02a): digits and + - ( ). */
const PHONE_TYPED = /^[\d\s+\-()]+$/;

/**
 * The new patient's fields from what was typed in the search: a text of only digits, spaces and
 * `+ - ( )`, with a digit in it, is a phone, the names left empty; otherwise its words, split at
 * spaces, are the names: the last word the last name and the rest the first name; one word alone is
 * the first name.
 */
export function newPatientFrom(typed: string): NewPatientStart {
  const text = typed.trim();
  if (PHONE_TYPED.test(text) && /\d/.test(text)) {
    return { firstName: '', lastName: '', phone: text };
  }
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length <= 1) return { firstName: words[0] ?? '', lastName: '', phone: '' };
  return {
    firstName: words.slice(0, -1).join(' '),
    lastName: words[words.length - 1] ?? '',
    phone: '',
  };
}

/**
 * True when a new patient has no way to be reached: no phone and no email (blank is none). They are
 * still booked, and the drawer says no reminder can reach them (scope-v1.md: allowed, flagged).
 */
export function unreachable(phone: string, email: string): boolean {
  return phone.trim() === '' && email.trim() === '';
}
