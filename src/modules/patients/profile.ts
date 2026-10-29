import { eq } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { dayInZone } from '@/lib/calendar-day';
import { clinicPlace } from '@/modules/tenancy';
import { ageOn, PATIENT_STATUSES, type PatientStatus } from './list';
import { phoneAsWritten } from './phone';
import { patients } from './schema';

/**
 * One patient as the profile shows them (E01-T03a). Calendar dates and moments are text, as a client
 * component takes them: the date of birth is `YYYY-MM-DD`, `createdAt` an ISO moment.
 */
export interface PatientProfile {
  id: string;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`; null without one. */
  dateOfBirth: string | null;
  /** Whole years on the clinic's today; null without a date of birth, or with one still to come. */
  age: number | null;
  /** As the clinic's people write it; null without a phone. */
  phone: string | null;
  email: string | null;
  /** The two-letter code of the language messages are written in. */
  language: string;
  /** When named, the phone and email above are the guardian's (D-033). */
  guardianName: string | null;
  /** Staff's administrative note: not a clinical record. '' when there is none. */
  notes: string;
  status: PatientStatus;
  createdAt: string;
}

/**
 * The patient with this id in the clinic of the transaction, or null: an id the clinic has no
 * patient by, another clinic's included (Row-Level Security shows the transaction its own clinic's
 * rows only). The age is on the clinic's today at `now`, the phone as its people write it. No audit
 * row here: the page's read declares the view (src/app/(staff)/patients/[id]/actions.ts).
 */
export async function patientProfile(
  tx: TenantTransaction,
  patientId: string,
  now: Date,
): Promise<PatientProfile | null> {
  const [row] = await tx.select().from(patients).where(eq(patients.id, patientId));
  if (!row) return null;
  const place = await clinicPlace(tx);
  const status = PATIENT_STATUSES.find((known) => known === row.status);
  if (!status) throw new Error('patients: a row holds a status the code does not know');
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    age: row.dateOfBirth === null ? null : ageOn(row.dateOfBirth, dayInZone(now, place.timeZone)),
    phone: row.phoneE164 === null ? null : phoneAsWritten(row.phoneE164, place.country),
    email: row.email,
    language: row.language,
    guardianName: row.guardianName,
    notes: row.notes,
    status,
    createdAt: row.createdAt.toISOString(),
  };
}
