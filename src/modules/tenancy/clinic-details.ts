import { eq, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { newClinicProblems, type NewClinic } from './create-clinic';
import { clinics } from './schema';
import { knownTimeZone } from './time-zone';

/**
 * A clinic's details (E01-T08a): what its owner sees and changes on Settings. Its name, phone and
 * email are what messages will name (E02); its zone, language, currency and country say where it is
 * (D-015).
 */
export interface ClinicDetails extends NewClinic {
  /** E.164 (`+38970001234`), read by the caller with the details' own country (D-097); or null. */
  phone: string | null;
  address: string | null;
  /** Stored lower-cased; or null. */
  email: string | null;
}

export type ClinicDetailField = keyof ClinicDetails;

/** The details in the order the Settings form shows them, which a save's changed fields keep. */
export const CLINIC_DETAIL_FIELDS = [
  'name',
  'phone',
  'address',
  'email',
  'timeZone',
  'locale',
  'currency',
  'country',
] as const satisfies readonly ClinicDetailField[];

/** Each detail's column. */
const COLUMNS = {
  name: clinics.name,
  phone: clinics.phone,
  address: clinics.address,
  email: clinics.email,
  timeZone: clinics.timezone,
  locale: clinics.locale,
  currency: clinics.currency,
  country: clinics.defaultCountry,
};

/**
 * The details of the clinic of this transaction: its own row, which Row-Level Security alone would
 * show it too (migration 0000).
 */
export async function clinicDetails(tx: TenantTransaction): Promise<ClinicDetails> {
  const [row] = await tx
    .select(COLUMNS)
    .from(clinics)
    .where(eq(clinics.id, sql`current_clinic_id()`));
  if (!row) throw new Error('clinicDetails: the clinic of this transaction was not found');
  return row;
}

/** Why a save stored nothing: the database does not know the zone by that name (D-110). */
export type SaveDetailsRefusal = 'time_zone_unknown';

export type SaveDetailsResult =
  { ok: true; changed: ClinicDetailField[] } | { ok: false; code: SaveDetailsRefusal };

/**
 * Sets the eight details of the clinic of this transaction and its updated_at (`now`), each by its
 * column: never `status` (the clinic's pause, the operator's, D-030) or `settings` (E02-T06,
 * E03-T06), and no other clinic's row. Gives the details whose stored value changed, in the form's
 * order, for the audit row. What is stored: the name and the address trimmed, the email trimmed and
 * lower-cased, an empty one as null, the zone as PostgreSQL spells it (knownTimeZone(), D-110).
 *
 * A zone the database does not know is refused as `time_zone_unknown`, with nothing written. Details
 * newClinicProblems() finds fault with are an Error: the caller's schema checks them first, each at
 * its field. The row is locked while it is read, so of two saves at once each names what it changed.
 */
export async function saveClinicDetails(
  tx: TenantTransaction,
  details: ClinicDetails,
  now: Date,
): Promise<SaveDetailsResult> {
  const problems = newClinicProblems(details);
  if (problems.length > 0) {
    throw new Error(`saveClinicDetails: the details cannot be stored (${problems.join(', ')})`);
  }
  const timeZone = await knownTimeZone(tx, details.timeZone);
  if (timeZone === null) return { ok: false, code: 'time_zone_unknown' };
  const next: ClinicDetails = {
    name: details.name.trim(),
    phone: filled(details.phone),
    address: filled(details.address),
    email: filled(details.email)?.toLowerCase() ?? null,
    timeZone,
    locale: details.locale,
    currency: details.currency,
    country: details.country,
  };
  const [before] = await tx
    .select(COLUMNS)
    .from(clinics)
    .where(eq(clinics.id, sql`current_clinic_id()`))
    .for('update');
  if (!before) throw new Error('saveClinicDetails: the clinic of this transaction was not found');
  await tx
    .update(clinics)
    .set({
      name: next.name,
      phone: next.phone,
      address: next.address,
      email: next.email,
      timezone: next.timeZone,
      locale: next.locale,
      currency: next.currency,
      defaultCountry: next.country,
      updatedAt: now,
    })
    .where(eq(clinics.id, sql`current_clinic_id()`));
  return {
    ok: true,
    changed: CLINIC_DETAIL_FIELDS.filter((field) => before[field] !== next[field]),
  };
}

/** The text trimmed, or null when nothing is left of it. */
function filled(text: string | null): string | null {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}
