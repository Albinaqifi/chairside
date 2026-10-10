import { sql } from 'drizzle-orm';
import { isSupportedCountry } from 'libphonenumber-js';
import type { TenantTransaction } from '@/db/tenant';
import { clinics } from './schema';

/** The locales a clinic may have: English only in v1, the one message file there is (D-053). */
export const CLINIC_LOCALES = ['en'] as const;

/** A clinic about to be made (E00-T05b): what `pnpm clinic:create` is given. */
export interface NewClinic {
  name: string;
  /** IANA, e.g. Europe/Skopje: every date and time the clinic's people see is in it (D-015). */
  timeZone: string;
  /** ISO 3166-1 alpha-2, e.g. MK: the clinic's own country, for phone numbers (D-097). */
  country: string;
  /** ISO 4217, e.g. MKD. */
  currency: string;
  /** The language of the clinic's texts. */
  locale: string;
}

export type NewClinicField = keyof NewClinic;

/** Three capital letters, as the column's check has it. */
const CURRENCY = /^[A-Z]{3}$/;

/**
 * The fields of a new clinic that must not be stored, in the order of NewClinic; none when it may
 * be. An empty name. A time zone Intl does not know, or a country the phone package does not
 * support: the database checks neither, and a clinic with such a zone fails every page of its
 * members, the login page and the clinic picker included, so they could neither switch clinic nor
 * log out (E01-T02a). A currency that is not three capital letters. A locale without texts (D-053).
 */
export function newClinicProblems(clinic: NewClinic): NewClinicField[] {
  const problems: Record<NewClinicField, boolean> = {
    name: clinic.name.trim() === '',
    timeZone: !isKnownTimeZone(clinic.timeZone),
    country: !isSupportedCountry(clinic.country),
    currency: !CURRENCY.test(clinic.currency),
    locale: !(CLINIC_LOCALES as readonly string[]).includes(clinic.locale),
  };
  return (Object.keys(problems) as NewClinicField[]).filter((field) => problems[field]);
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds the clinic of this transaction (withTenant for a new id: its row is current_clinic_id(), the
 * only one the policy lets the transaction add) and gives its id: the clinic, active, its name
 * trimmed, both moments `now`. A clinic newClinicProblems() finds fault with is an Error, with
 * nothing written: the caller checks first and says which field.
 */
export async function createClinic(
  tx: TenantTransaction,
  clinic: NewClinic,
  now: Date,
): Promise<string> {
  const problems = newClinicProblems(clinic);
  if (problems.length > 0) {
    throw new Error(`createClinic: the clinic cannot be stored (${problems.join(', ')})`);
  }
  const [row] = await tx
    .insert(clinics)
    .values({
      id: sql`current_clinic_id()`,
      name: clinic.name.trim(),
      timezone: clinic.timeZone,
      locale: clinic.locale,
      currency: clinic.currency,
      defaultCountry: clinic.country,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: clinics.id });
  if (!row) throw new Error('createClinic: the clinic was not added');
  return row.id;
}
