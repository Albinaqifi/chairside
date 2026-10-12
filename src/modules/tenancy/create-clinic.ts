import { sql } from 'drizzle-orm';
import { getCountries, isSupportedCountry } from 'libphonenumber-js';
import type { TenantTransaction } from '@/db/tenant';
import { clinics } from './schema';
import { isClinicTimeZoneName, knownTimeZone } from './time-zone';

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
 * be. An empty name. A time zone that is no region's name or UTC, or that Intl does not know
 * (isClinicTimeZoneName(), D-110: so never an offset), or a country the phone package does not
 * support: the database checks neither, and a clinic with a zone Intl does not know fails every page
 * of its members, the login page and the clinic picker included, so they could neither switch clinic
 * nor log out (E01-T02a). A currency that is not three capital letters. A locale without texts
 * (D-053). The checks that need no database: whether the database knows the zone is
 * knownTimeZone()'s, in the transaction that stores it.
 */
export function newClinicProblems(clinic: NewClinic): NewClinicField[] {
  const problems: Record<NewClinicField, boolean> = {
    name: clinic.name.trim() === '',
    timeZone: !isClinicTimeZoneName(clinic.timeZone),
    country: !isSupportedCountry(clinic.country),
    currency: !CURRENCY.test(clinic.currency),
    locale: !(CLINIC_LOCALES as readonly string[]).includes(clinic.locale),
  };
  return (Object.keys(problems) as NewClinicField[]).filter((field) => problems[field]);
}

/** The countries a clinic may have, as newClinicProblems() checks them: the phone package's (D-097). */
export function clinicCountries(): string[] {
  return getCountries();
}

/**
 * The currencies a clinic is offered (E01-T08a): Intl's, each three capital letters as
 * newClinicProblems() checks them. The check takes any three; a clinic's other one stays its own.
 */
export function clinicCurrencies(): string[] {
  return Intl.supportedValuesOf('currency').filter((code) => CURRENCY.test(code));
}

/**
 * Adds the clinic of this transaction (withTenant for a new id: its row is current_clinic_id(), the
 * only one the policy lets the transaction add) and gives its id: the clinic, active, its name
 * trimmed, its zone as PostgreSQL spells it (knownTimeZone(), D-110), both moments `now`. A clinic
 * newClinicProblems() finds fault with, or whose zone the database does not know, is an Error, with
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
  const timeZone = await knownTimeZone(tx, clinic.timeZone);
  if (timeZone === null) {
    throw new Error(
      'createClinic: the clinic cannot be stored (timeZone: the database does not know it)',
    );
  }
  const [row] = await tx
    .insert(clinics)
    .values({
      id: sql`current_clinic_id()`,
      name: clinic.name.trim(),
      timezone: timeZone,
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
