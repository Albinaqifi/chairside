import type { TenantTransaction } from '@/db/tenant';
import { clinics } from './schema';

/** Where the clinic is, as dates, times and phone numbers are written there (D-015). */
export interface ClinicPlace {
  /** IANA, e.g. Europe/Skopje: every date and time the clinic's people see is in it. */
  timeZone: string;
  /** ISO 3166-1 alpha-2, e.g. MK: the clinic's own country, for phone numbers. */
  country: string;
}

/**
 * The time zone and country of the clinic of this transaction. Row-Level Security shows a
 * transaction its own clinic's row only (migration 0000). A zone that Intl does not know fails
 * here, loudly, rather than as dates shown in another zone.
 */
export async function clinicPlace(tx: TenantTransaction): Promise<ClinicPlace> {
  const [row] = await tx
    .select({ timeZone: clinics.timezone, country: clinics.defaultCountry })
    .from(clinics);
  if (!row) throw new Error('clinicPlace: the clinic of this transaction was not found');
  try {
    new Intl.DateTimeFormat('en', { timeZone: row.timeZone });
  } catch (error) {
    throw new Error('clinicPlace: the clinic has a time zone Intl does not know', { cause: error });
  }
  return row;
}
