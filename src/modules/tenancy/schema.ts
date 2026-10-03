import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
