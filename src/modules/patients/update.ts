import { eq } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { clinicPlace } from '@/modules/tenancy';
import { filled } from './create';
import { PATIENT_STATUSES, type PatientStatus } from './list';
import { readPhone } from './phone';
import { patients } from './schema';

/**
 * A patient's details as the edit form sends them (E01-T03b), each field's form checked by the
 * caller's schema as `NewPatient`'s are, plus the status. An optional field left empty is null.
 */
export interface PatientChanges {
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD` or none. */
  dateOfBirth: string | null;
  /** As typed: read below with the clinic's own country, as `create` reads it. */
  phone: string | null;
  email: string | null;
  language: string;
  guardianName: string | null;
  notes: string;
  status: PatientStatus;
}

/** The name of each field an edit can change: what the audit row lists, never a value. */
export type ChangedField =
  | 'firstName'
  | 'lastName'
  | 'dateOfBirth'
  | 'phone'
  | 'email'
  | 'language'
  | 'guardianName'
  | 'notes'
  | 'status';

/**
 * Refused, with nothing written, and never thrown:
 * - `not_found`: no patient of the clinic by this id (another clinic's too).
 * - `phone_impossible`: the phone cannot be read with the clinic's country.
 * - `nothing_changed`: every value is the one stored.
 * - `visits_ahead`: archived or deceased was asked for, and the patient has a visit ahead.
 */
export type UpdateRefusal = 'not_found' | 'phone_impossible' | 'nothing_changed' | 'visits_ahead';

export type UpdateResult =
  { ok: true; fields: ChangedField[] } | { ok: false; code: UpdateRefusal };

/** The statuses a patient with a visit ahead may not be put in: E02 sends such a patient nothing. */
const NO_VISIT_AHEAD: readonly PatientStatus[] = ['archived', 'deceased'];

/**
 * Saves a patient's details (E01-T03b). The row is locked `for update` first, so an edit and a
 * booking of the same patient take turns (the booking reads the row `for share`, `patientStatus`):
 * the one that comes second waits, and sees the other's work. Then the phone is read as `create`
 * reads it, and every value is compared with the stored one in the form it will be stored in (the
 * phone as E.164, the email lower-cased, names and notes trimmed, an empty optional field as null).
 * Only the fields that differ are written, with `updated_at` set to `now`; their names are returned.
 * With no field changed nothing is written: `nothing_changed`.
 *
 * Setting archived or deceased is refused as `visits_ahead` when `hasVisitAhead` says the patient has
 * a visit that holds the chair and has not ended (the owner's rule, D-114). The scheduling module
 * knows that and this one cannot ask it, so the action passes the question in; it is asked after the
 * lock, and only when the status is changing to one of the two: a patient already archived keeps
 * their other details editable. Back to active is always saved.
 */
export async function update(
  tx: TenantTransaction,
  patientId: string,
  changes: PatientChanges,
  now: Date,
  hasVisitAhead: () => Promise<boolean>,
): Promise<UpdateResult> {
  const [row] = await tx.select().from(patients).where(eq(patients.id, patientId)).for('update');
  if (!row) return { ok: false, code: 'not_found' };

  let phoneE164: string | null = null;
  const typedPhone = filled(changes.phone);
  if (typedPhone !== null) {
    phoneE164 = readPhone(typedPhone, (await clinicPlace(tx)).country);
    if (phoneE164 === null) return { ok: false, code: 'phone_impossible' };
  }
  const status = PATIENT_STATUSES.find((known) => known === row.status);
  if (!status) throw new Error('patients: a row holds a status the code does not know');

  const stored = {
    firstName: changes.firstName.trim(),
    lastName: changes.lastName.trim(),
    dateOfBirth: filled(changes.dateOfBirth),
    phoneE164,
    email: filled(changes.email)?.toLowerCase() ?? null,
    language: changes.language,
    guardianName: filled(changes.guardianName),
    notes: changes.notes.trim(),
    status: changes.status,
  };
  const fields: ChangedField[] = [];
  if (stored.firstName !== row.firstName) fields.push('firstName');
  if (stored.lastName !== row.lastName) fields.push('lastName');
  if (stored.dateOfBirth !== row.dateOfBirth) fields.push('dateOfBirth');
  if (stored.phoneE164 !== row.phoneE164) fields.push('phone');
  if (stored.email !== row.email) fields.push('email');
  if (stored.language !== row.language) fields.push('language');
  if (stored.guardianName !== row.guardianName) fields.push('guardianName');
  if (stored.notes !== row.notes) fields.push('notes');
  if (stored.status !== status) fields.push('status');
  if (fields.length === 0) return { ok: false, code: 'nothing_changed' };

  const archiving = stored.status !== status && NO_VISIT_AHEAD.includes(stored.status);
  if (archiving && (await hasVisitAhead())) return { ok: false, code: 'visits_ahead' };
  await tx
    .update(patients)
    .set({ ...stored, updatedAt: now })
    .where(eq(patients.id, patientId));
  return { ok: true, fields };
}
