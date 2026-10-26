import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { newId } from '@/lib/ids';
import { clinicPlace } from '@/modules/tenancy';
import { readPhone } from './phone';
import { patients } from './schema';

/**
 * A new patient as the desk typed them (E01-T02b), each field's form checked by the caller's schema:
 * the names not empty, the email an email, the date of birth a calendar date (YYYY-MM-DD), the
 * language a two-letter code (ISO 639-1, any two lower-case letters, D-053). An optional field left
 * empty is null.
 */
export interface NewPatient {
  /**
   * The id the caller made for them (E01-T05d: the booking drawer makes one per opening, so the same
   * booking sent twice adds them once); left out, a new one. A UUID, checked by the caller's schema.
   */
  id?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  /** As typed: read below with the clinic's own country. */
  phone: string | null;
  email: string | null;
  language: string;
  /** When set, the phone and email are the guardian's, and messages address them (D-033). */
  guardianName: string | null;
  /** An administrative note, "not a clinical record"; '' for none (the column is not null). */
  notes: string;
}

/** The desk's mistakes, answered as a code and never thrown: the action refuses with it. */
export type CreateRefusal = 'phone_impossible';

/**
 * Added, or refused. `created` is false when a patient by the id given already existed, so nothing
 * was written (E01-T05d): the caller writes no audit row for them.
 */
export type CreateResult =
  { ok: true; id: string; created: boolean } | { ok: false; code: CreateRefusal };

/**
 * Adds one patient to the clinic of the transaction (its own row: current_clinic_id(), which the
 * policy checks too) and gives their id. With an id given and a patient by that id already there,
 * it writes nothing and says so (`created: false`): ON CONFLICT (id) DO NOTHING, which waits for a
 * transaction adding the same id at the same moment to end, then sees its row if it committed. The
 * key is global: a patient of another clinic by that id, which Row-Level Security hides, also
 * writes nothing; the caller then finds no patient of its clinic by that id (patientStatus). The
 * phone is read with the clinic's own country, never with
 * one a page sends, and stored in E.164; an impossible one is refused as `phone_impossible`, with
 * nothing written. What is stored: names, guardian and notes trimmed, the email lower-cased, an
 * empty optional field as null. The transaction's clinic is read through the policy alone
 * (clinicPlace): this runs as the app role, never the migration role (the seed writes its own rows).
 * E01-T05's quick new patient and E04's import write through here too.
 */
export async function create(
  tx: TenantTransaction,
  patient: NewPatient,
  now: Date,
): Promise<CreateResult> {
  let phoneE164: string | null = null;
  const phone = filled(patient.phone);
  if (phone !== null) {
    phoneE164 = readPhone(phone, (await clinicPlace(tx)).country);
    if (phoneE164 === null) return { ok: false, code: 'phone_impossible' };
  }
  const id = patient.id ?? newId();
  const written = await tx
    .insert(patients)
    .values({
      id,
      clinicId: sql`current_clinic_id()`,
      firstName: patient.firstName.trim(),
      lastName: patient.lastName.trim(),
      dateOfBirth: filled(patient.dateOfBirth),
      phoneE164,
      email: filled(patient.email)?.toLowerCase() ?? null,
      language: patient.language,
      guardianName: filled(patient.guardianName),
      notes: patient.notes.trim(),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: patients.id })
    .returning({ id: patients.id });
  return { ok: true, id, created: written.length > 0 };
}

/** The text trimmed, or null when nothing is left of it. */
export function filled(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
