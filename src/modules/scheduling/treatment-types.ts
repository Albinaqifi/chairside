import { asc, eq } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { treatmentTypes } from './schema';

/** A treatment of the clinic's catalogue the desk can book (E01-T05a). */
export interface TreatmentType {
  id: string;
  /** Its name, the title of the appointments booked with it ("Filling"). */
  name: string;
  /** How long it takes, in minutes: the length a booking starts with. */
  minutes: number;
}

/**
 * The clinic's active treatment types, by name: the ones a booking can take (E01-T05a). An
 * inactive one keeps its appointments and gets no new ones, as an inactive provider does.
 */
export async function activeTreatmentTypes(tx: TenantTransaction): Promise<TreatmentType[]> {
  return tx
    .select({
      id: treatmentTypes.id,
      name: treatmentTypes.name,
      minutes: treatmentTypes.defaultDurationMin,
    })
    .from(treatmentTypes)
    .where(eq(treatmentTypes.active, true))
    .orderBy(asc(treatmentTypes.name), asc(treatmentTypes.id));
}
