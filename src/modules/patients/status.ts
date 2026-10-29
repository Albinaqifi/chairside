import { eq } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { PATIENT_STATUSES, type PatientStatus } from './list';
import { patients } from './schema';

/**
 * The status of this patient of the clinic, or null when the clinic has none by this id (Row-Level
 * Security shows the transaction its own clinic's rows only). The booking action asks it: only an
 * active patient is booked (owner, D-113). No audit row: a status is no record view (D-098).
 *
 * The row is read `for share`, held to the end of the transaction (E01-T03b): an edit of the same
 * patient (`update`) locks the row `for update` first, so the two take turns. A booking that reads
 * first makes the edit wait, and the edit then sees its visit and refuses to archive; an edit that
 * locks first makes the booking wait, and it then reads the new status. The booking takes the
 * patient's row before the provider's, as the edit takes the patient's before anything: no deadlock.
 */
export async function patientStatus(
  tx: TenantTransaction,
  patientId: string,
): Promise<PatientStatus | null> {
  const [row] = await tx
    .select({ status: patients.status })
    .from(patients)
    .where(eq(patients.id, patientId))
    .for('share');
  if (!row) return null;
  const status = PATIENT_STATUSES.find((known) => known === row.status);
  if (!status) throw new Error('patients: a row holds a status the code does not know');
  return status;
}
