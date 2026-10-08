import { inArray, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { appointments } from './schema';

/** A patient's last and next visit: the start of each, or null when there is none. */
export interface PatientVisits {
  /** The last completed appointment. */
  last: Date | null;
  /** The first booked or confirmed appointment that has not ended at `now`. */
  next: Date | null;
}

/**
 * The last and next visit of each of these patients, by patient id; a patient with neither is not
 * in the map. A visit under way and not yet marked arrived, or a patient who is late, still shows
 * as next until it ends. Cancelled visits and no-shows are neither.
 */
export async function lastAndNextVisits(
  tx: TenantTransaction,
  patientIds: readonly string[],
  now: Date,
): Promise<Map<string, PatientVisits>> {
  if (patientIds.length === 0) return new Map();
  const rows = await tx
    .select({
      patientId: appointments.patientId,
      last: sql<Date | null>`max(${appointments.startsAt}) filter (where ${appointments.status} = 'completed')`.mapWith(
        appointments.startsAt,
      ),
      next: sql<Date | null>`min(${appointments.startsAt}) filter (where ${appointments.status} in ('booked', 'confirmed') and ${appointments.endsAt} > ${now})`.mapWith(
        appointments.startsAt,
      ),
    })
    .from(appointments)
    .where(inArray(appointments.patientId, [...patientIds]))
    .groupBy(appointments.patientId);
  return new Map(rows.map(({ patientId, last, next }) => [patientId, { last, next }]));
}
