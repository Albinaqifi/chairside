import { inArray } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { patients } from './schema';

/** A patient's name, as a list of appointments shows it. */
export interface PatientName {
  firstName: string;
  lastName: string;
}

/**
 * The names of these patients of the clinic, by patient id; an id that is not one of its patients
 * is not in the map (Row-Level Security shows the transaction its own clinic's rows only). For a
 * list such as the calendar's day: no audit row, a list is not a patient record view (D-098).
 */
export async function patientNames(
  tx: TenantTransaction,
  patientIds: readonly string[],
): Promise<Map<string, PatientName>> {
  if (patientIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
    .from(patients)
    .where(inArray(patients.id, [...new Set(patientIds)]));
  return new Map(rows.map(({ id, firstName, lastName }) => [id, { firstName, lastName }]));
}
