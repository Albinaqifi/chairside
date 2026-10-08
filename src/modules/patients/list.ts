import { asc, count, sql, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { lastAndNextVisits } from '@/modules/scheduling';
import { clinicPlace } from '@/modules/tenancy';
import { phoneAsWritten } from './phone';
import { patients } from './schema';

/** The most patients the list shows: whoever is not among them is found by typing more. */
export const LIST_LIMIT = 50;

export const PATIENT_STATUSES = ['active', 'archived', 'deceased'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

/** One patient as the list shows them. Moments are ISO strings, as a client component takes them. */
export interface PatientRow {
  id: string;
  firstName: string;
  lastName: string;
  status: PatientStatus;
  /** Whole years on the clinic's today; null without a date of birth. */
  age: number | null;
  /** As the clinic's people write it; null without a phone. */
  phone: string | null;
  /** When the last completed visit started; null without one. */
  lastVisit: string | null;
  /** When the next booked or confirmed visit starts; null without one. */
  nextVisit: string | null;
}

export interface PatientList {
  /** The clinic's patients, of every status. */
  total: number;
  /** Those that match, at most LIST_LIMIT, by last name, then first name. */
  rows: PatientRow[];
  /** True when more patients match than the rows hold. */
  more: boolean;
}

/**
 * The patient list (E01-T02a): the clinic's patients whose full name holds what was typed, in any
 * case, or whose phone holds the digits typed, however they are written (searchTerms). With nothing
 * typed, the first LIST_LIMIT. Every status. Last and next visit come from the scheduling module,
 * the age is on the clinic's today and the phone as its people write it.
 *
 * The query reads the clinic's patients through the clinic's own key: Row-Level Security lets no
 * index serve the match (D-096). The typed text goes in as values only, never cast to a name such
 * as `::regconfig`: withoutQueryValues() cleans the errors of class 22 and 42601 alone, so such a
 * value would stay in a logged error. strpos() matches the text as it is: `%` and `_` are letters.
 */
export async function listPatients(
  tx: TenantTransaction,
  typed: string,
  now: Date,
): Promise<PatientList> {
  const { text, digits } = searchTerms(typed);
  const found = await tx
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      status: patients.status,
      dateOfBirth: patients.dateOfBirth,
      phoneE164: patients.phoneE164,
    })
    .from(patients)
    .where(text === '' ? undefined : matching(text, digits))
    .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.id))
    .limit(LIST_LIMIT + 1);
  const [counted] = await tx.select({ total: count() }).from(patients);
  const shown = found.slice(0, LIST_LIMIT);
  const place = await clinicPlace(tx);
  const today = dayInZone(now, place.timeZone);
  const visits = await lastAndNextVisits(
    tx,
    shown.map((patient) => patient.id),
    now,
  );
  return {
    total: counted?.total ?? 0,
    more: found.length > LIST_LIMIT,
    rows: shown.map((patient) => {
      const visit = visits.get(patient.id);
      return {
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        status: toStatus(patient.status),
        age: patient.dateOfBirth === null ? null : ageOn(patient.dateOfBirth, today),
        phone: patient.phoneE164 === null ? null : phoneAsWritten(patient.phoneE164, place.country),
        lastVisit: visit?.last?.toISOString() ?? null,
        nextVisit: visit?.next?.toISOString() ?? null,
      };
    }),
  };
}

/** The signs a phone number is written with besides its digits: `+389 (70) 001-234`. */
const PHONE_TEXT = /^[\d\s+().\/-]+$/;

/**
 * What a search looks for: the text, trimmed, its spaces each one; and when it is written as a
 * phone number, its digits, without a leading `00` or `0`. So `+389 70 001 234`, `0038970001234`
 * and `070 001 234` all find +38970001234. Text with letters in it looks for names only.
 */
export function searchTerms(typed: string): { text: string; digits: string | null } {
  const text = typed.trim().replace(/\s+/g, ' ');
  if (!PHONE_TEXT.test(text)) return { text, digits: null };
  const all = text.replace(/\D/g, '');
  const digits = all.startsWith('00') ? all.slice(2) : all.startsWith('0') ? all.slice(1) : all;
  return { text, digits: digits === '' ? null : digits };
}

function matching(text: string, digits: string | null): SQL {
  const name = sql`strpos(lower(${patients.firstName} || ' ' || ${patients.lastName}), lower(${text})) > 0`;
  return digits === null ? name : sql`(${name} or strpos(${patients.phoneE164}, ${digits}) > 0)`;
}

/** The day it is in this time zone at this moment, YYYY-MM-DD, whatever the computer's zone. */
export function dayInZone(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((found) => found.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * Whole years from a date of birth to a day, both YYYY-MM-DD; someone born on 29 February is a
 * year older on 1 March. Null for a birth after the day.
 */
export function ageOn(born: string, day: string): number | null {
  if (born > day) return null;
  const years = Number(day.slice(0, 4)) - Number(born.slice(0, 4));
  return day.slice(5) < born.slice(5) ? years - 1 : years;
}

function toStatus(value: string): PatientStatus {
  const status = PATIENT_STATUSES.find((known) => known === value);
  if (!status) throw new Error('patients: a row holds a status the code does not know');
  return status;
}
