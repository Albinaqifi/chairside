import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@/lib/ids';
import { clinics } from '@/modules/tenancy/schema'; // for the foreign key only (D-058)

/**
 * A clinic's patient (E01-T01a, data-model.md section 2). No login. Patients are archived,
 * marked deceased or anonymised, never deleted: the app role has no DELETE here (migration 0002).
 *
 * - A child's record holds the guardian's name, and then its phone and email are the guardian's:
 *   messages address the guardian (D-033; Q-15, built on its assumption). A shared phone is
 *   never, on its own, a duplicate.
 * - `language`: the two-letter code of the language messages are written in, checked by its
 *   form, not against a list (no language comes before the translation pass, D-053).
 * - `notes`: an administrative note, labelled "not a clinical record" wherever it is shown.
 * - `import_job_id` comes with `import_jobs` (E04-T01, D-091).
 */
export const patients = pgTable(
  'patients',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: date('date_of_birth'),
    phoneE164: text('phone_e164'), // E.164
    email: text('email'), // lower-case
    language: text('language').notNull(), // ISO 639-1, e.g. en
    guardianName: text('guardian_name'),
    notes: text('notes').notNull().default(''),
    status: text('status').notNull().default('active'),
    phoneInvalidAt: timestamp('phone_invalid_at', { withTimezone: true }),
    emailInvalidAt: timestamp('email_invalid_at', { withTimezone: true }),
    whatsappStatus: text('whatsapp_status').notNull().default('unknown'),
    whatsappCheckedAt: timestamp('whatsapp_checked_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('patients_clinic_id_id_key').on(t.clinicId, t.id),
    // The patient search (E01-T02) matches parts of the full name and of the phone number. Its
    // query must use these exact expressions for PostgreSQL to use the indexes (pg_trgm).
    index('patients_full_name_trgm_idx').using(
      'gin',
      sql`(${t.firstName} || ' ' || ${t.lastName}) gin_trgm_ops`,
    ),
    index('patients_phone_e164_trgm_idx').using('gin', t.phoneE164.op('gin_trgm_ops')),
    check('patients_status_check', sql`${t.status} in ('active', 'archived', 'deceased')`),
    check(
      'patients_whatsapp_status_check',
      sql`${t.whatsappStatus} in ('unknown', 'available', 'unavailable')`,
    ),
    check('patients_language_check', sql`${t.language} ~ '^[a-z]{2}$'`),
    check('patients_phone_e164_check', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{1,14}$'`),
    check('patients_email_check', sql`${t.email} = lower(${t.email})`),
  ],
);
