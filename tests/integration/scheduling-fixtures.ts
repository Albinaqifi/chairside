import { sql, type SQL } from 'drizzle-orm';
import pg from 'pg';
import { newId } from '@/lib/ids';
import { testEmail } from './fixtures';

/**
 * Rows of the seven scheduling tables (E01-T01a) for the integration tests. Each builder gives the
 * columns of one valid, synthetic row; a test changes one column to see the database refuse it.
 * Rows are written as the migration role (`insertRow`), which Row-Level Security does not hold, or
 * as the app role inside withTenant (`insertSql`).
 */

export const SCHEDULING_TABLES = [
  'providers',
  'provider_breaks',
  'treatment_types',
  'patients',
  'appointments',
  'clinic_hours',
  'closed_days',
] as const;
export type SchedulingTable = (typeof SCHEDULING_TABLES)[number];

/** The tables whose rows the app role may delete; the others are archived, never deleted. */
export const DELETABLE_TABLES: readonly SchedulingTable[] = [
  'provider_breaks',
  'clinic_hours',
  'closed_days',
];

export type Row = Record<string, unknown>;

/** What a clinic's rows point at: a provider, a patient and a treatment type of that clinic. */
export interface ClinicRefs {
  clinicId: string;
  providerId: string;
  patientId: string;
  treatmentTypeId: string;
  /** Who booked its appointments: a user, global like every user. */
  userId: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A Monday morning in UTC; appointment `n` starts `n` hours later. */
const FIRST_START = Date.parse('2026-03-09T08:00:00Z');

/** The start of appointment slot `n`, as an ISO string: slots never overlap one another. */
export function slot(n: number, minutesFromStart = 0): string {
  return new Date(FIRST_START + n * HOUR + minutesFromStart * MINUTE).toISOString();
}

/**
 * One valid row of the table, in the clinic `refs` names, with a new id. `n` varies what must not
 * repeat in one clinic: the weekday of opening hours, the date of a closed day, and the hour of an
 * appointment (30 minutes from slot `n`).
 */
export function validRow(table: SchedulingTable, refs: ClinicRefs, n = 0): Row {
  const base = { id: newId(), clinic_id: refs.clinicId };
  switch (table) {
    case 'providers':
      return {
        ...base,
        name: 'Dentist',
        short_name: 'D',
        kind: 'dentist',
        chair_label: 'Chair 1',
        color_hue: 210,
      };
    case 'provider_breaks':
      return {
        ...base,
        provider_id: refs.providerId,
        weekday: (n % 7) + 1,
        starts: '12:00',
        ends: '12:30',
        label: 'Lunch',
      };
    case 'treatment_types':
      return { ...base, name: 'Check-up', default_duration_min: 30 };
    case 'patients':
      return { ...base, first_name: 'Synthetic', last_name: 'Patient', language: 'en' };
    case 'appointments':
      return {
        ...base,
        patient_id: refs.patientId,
        provider_id: refs.providerId,
        treatment_type_id: refs.treatmentTypeId,
        title: 'Check-up',
        starts_at: slot(n),
        ends_at: slot(n, 30),
        source: 'staff',
        created_by: refs.userId,
      };
    case 'clinic_hours':
      return { ...base, weekday: (n % 7) + 1, opens: '08:00', closes: '16:00' };
    case 'closed_days':
      return {
        ...base,
        date: new Date(FIRST_START + n * DAY).toISOString().slice(0, 10),
        label: 'Holiday',
      };
  }
}

/** Inserts a row as the given connection's role: the migrator, or the app without a clinic. */
export async function insertRow(db: pg.Pool, table: string, row: Row): Promise<void> {
  const columns = Object.keys(row);
  await db.query(
    `insert into ${pg.escapeIdentifier(table)} (${columns.map((c) => pg.escapeIdentifier(c)).join(', ')})
     values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row),
  );
}

/** The same insert for a tenant transaction: `tx.execute(insertSql(table, row))`. */
export function insertSql(table: string, row: Row): SQL {
  const columns = sql.join(
    Object.keys(row).map((column) => sql.identifier(column)),
    sql`, `,
  );
  const values = sql.join(
    Object.values(row).map((value) => sql`${value}`),
    sql`, `,
  );
  return sql`insert into ${sql.identifier(table)} (${columns}) values (${values})`;
}

/** A user row without a login, for `appointments.created_by`. Users are global (D-062). */
export async function insertUser(db: pg.Pool): Promise<string> {
  const id = newId();
  await db.query(`insert into users (id, name, email) values ($1, 'Front desk', $2)`, [
    id,
    testEmail(),
  ]);
  return id;
}

/** Inserts a provider of the given kind in the clinic, and returns its id. */
export async function insertProvider(
  db: pg.Pool,
  clinicId: string,
  kind: 'dentist' | 'hygienist' | 'other' = 'dentist',
): Promise<string> {
  const id = newId();
  await insertRow(db, 'providers', {
    ...validRow('providers', { clinicId } as ClinicRefs),
    id,
    kind,
  });
  return id;
}

/**
 * Inserts what a clinic's rows point at, a provider, a patient and a treatment type, as the
 * migrator, and returns their ids with the clinic's and the user's.
 */
export async function insertClinicRefs(
  db: pg.Pool,
  clinicId: string,
  userId: string,
): Promise<ClinicRefs> {
  const refs = { clinicId, userId } as ClinicRefs;
  const patient = validRow('patients', refs);
  const treatmentType = validRow('treatment_types', refs);
  await insertRow(db, 'patients', patient);
  await insertRow(db, 'treatment_types', treatmentType);
  return {
    clinicId,
    userId,
    providerId: await insertProvider(db, clinicId),
    patientId: patient.id as string,
    treatmentTypeId: treatmentType.id as string,
  };
}
