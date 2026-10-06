import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '@/lib/ids';

/**
 * The tenant. Every tenant table points at a clinic through `clinic_id`; this table's own `id`
 * is the clinic id, and its Row-Level Security policy compares `id` (migration 0000).
 */
export const clinics = pgTable(
  'clinics',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(), // IANA, e.g. Europe/Skopje
    locale: text('locale').notNull(), // e.g. en
    currency: text('currency').notNull(), // ISO 4217, e.g. MKD
    defaultCountry: text('default_country').notNull(), // ISO 3166-1 alpha-2, e.g. MK
    phone: text('phone'), // E.164
    address: text('address'),
    email: text('email'), // lower-case
    status: text('status').notNull().default('active'),
    // Read only through a typed, validated accessor (data-model.md), never as raw JSON.
    settings: jsonb('settings').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('clinics_status_check', sql`${t.status} in ('active', 'paused')`),
    check('clinics_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('clinics_default_country_check', sql`${t.defaultCountry} ~ '^[A-Z]{2}$'`),
    check('clinics_phone_check', sql`${t.phone} ~ '^\\+[1-9][0-9]{1,14}$'`),
    check('clinics_email_check', sql`${t.email} = lower(${t.email})`),
    check('clinics_settings_check', sql`jsonb_typeof(${t.settings}) = 'object'`),
  ],
);

/*
 * Opening hours and closed days (E01-T01a, data-model.md section 1). Times and dates are the
 * clinic's own, in its time zone (`clinics.timezone`): a `time` and a `date` hold no zone.
 * Weekdays are ISO numbers, as PostgreSQL's `isodow`: 1 = Monday … 7 = Sunday.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** When the clinic is open: one row per weekday it opens. A weekday without a row is closed. */
export const clinicHours = pgTable(
  'clinic_hours',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    weekday: integer('weekday').notNull(),
    opens: time('opens').notNull(),
    closes: time('closes').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('clinic_hours_clinic_id_id_key').on(t.clinicId, t.id),
    unique('clinic_hours_clinic_id_weekday_key').on(t.clinicId, t.weekday),
    check('clinic_hours_weekday_check', sql`${t.weekday} between 1 and 7`),
    check('clinic_hours_opens_check', sql`${t.opens} < ${t.closes}`),
  ],
);

/** Days the clinic is closed although its hours say open: holidays. One row per date. */
export const closedDays = pgTable(
  'closed_days',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    date: date('date').notNull(),
    label: text('label').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('closed_days_clinic_id_id_key').on(t.clinicId, t.id),
    unique('closed_days_clinic_id_date_key').on(t.clinicId, t.date),
  ],
);
