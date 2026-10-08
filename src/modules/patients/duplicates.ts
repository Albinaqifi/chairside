import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { clinicPlace } from '@/modules/tenancy';
import { filled, type NewPatient } from './create';
import { readPhone } from './phone';
import { patients } from './schema';

/** What the desk has typed so far that a likely duplicate is found by. */
export type TypedPatient = Pick<
  NewPatient,
  'firstName' | 'lastName' | 'dateOfBirth' | 'phone' | 'email'
>;

/** A patient of the clinic who may be the one being typed, as the warning names them. */
export interface LikelyDuplicate {
  id: string;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD, or null: a calendar date, formatted in UTC where it is shown (D-098). */
  dateOfBirth: string | null;
}

/** The most likely duplicates the warning names. */
export const DUPLICATES_LIMIT = 3;

/**
 * The clinic's patients who are likely the one being typed (D-033, E01-T02b): the same name and
 * the same date of birth, or the same name and the same phone or email. The same name is the same
 * first and the same last name, each trimmed and compared in any case with lower(), as the search
 * compares. A shared phone alone is never a likely duplicate: siblings share one. The phone is read
 * as patients.create reads it (readPhone, with the clinic's own country), so E.164 numbers are
 * compared and an impossible phone matches no one. Every status. Nothing is written: a warning is
 * no record view (D-098). The typed words go in as values only.
 */
export async function likelyDuplicates(
  tx: TenantTransaction,
  typed: TypedPatient,
): Promise<LikelyDuplicate[]> {
  const first = filled(typed.firstName);
  const last = filled(typed.lastName);
  if (first === null || last === null) return [];
  const also: SQL[] = [];
  const born = filled(typed.dateOfBirth);
  if (born !== null) also.push(eq(patients.dateOfBirth, born));
  const phone = filled(typed.phone);
  if (phone !== null) {
    const e164 = readPhone(phone, (await clinicPlace(tx)).country);
    if (e164 !== null) also.push(eq(patients.phoneE164, e164));
  }
  const email = filled(typed.email)?.toLowerCase();
  if (email !== undefined) also.push(eq(patients.email, email));
  if (also.length === 0) return [];
  return tx
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      dateOfBirth: patients.dateOfBirth,
    })
    .from(patients)
    .where(
      and(
        sql`lower(${patients.firstName}) = lower(${first})`,
        sql`lower(${patients.lastName}) = lower(${last})`,
        or(...also),
      ),
    )
    .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.id))
    .limit(DUPLICATES_LIMIT);
}
