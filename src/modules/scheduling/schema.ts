import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newId } from '@/lib/ids';
import { users } from '@/modules/auth/schema'; // for the foreign key only (D-058)
import { patients } from '@/modules/patients/schema'; // for the foreign key only (D-058)
import { clinics } from '@/modules/tenancy/schema'; // for the foreign key only (D-058)

/*
 * The scheduling tables (E01-T01a, data-model.md section 2). A foreign key to another tenant table
 * includes `clinic_id`, so a row can only point at a row of its own clinic. One with a null column
 * (`treatment_type_id`) is not checked, which is what an optional link wants.
 *
 * Providers and treatment types are made inactive and appointments cancelled, never deleted: the
 * app role has no DELETE on them (migration 0002). Breaks are deleted.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** One calendar column: a dentist, a hygienist or another provider. The chair is a label (D-019). */
export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    kind: text('kind').notNull(),
    chairLabel: text('chair_label').notNull(),
    colorHue: integer('color_hue').notNull(), // the column's colour: a hue in degrees, 0–359
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('providers_clinic_id_id_key').on(t.clinicId, t.id),
    check('providers_kind_check', sql`${t.kind} in ('dentist', 'hygienist', 'other')`),
    check('providers_color_hue_check', sql`${t.colorHue} between 0 and 359`),
  ],
);

/**
 * A weekly repeating break of one provider, such as lunch: shown hatched on the calendar, never an
 * appointment (D-018). From `starts` to `ends` on that weekday, in the clinic's time zone; the
 * weekday is ISO, 1 = Monday … 7 = Sunday, as in `clinic_hours`.
 */
export const providerBreaks = pgTable(
  'provider_breaks',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    providerId: uuid('provider_id').notNull(),
    weekday: integer('weekday').notNull(),
    starts: time('starts').notNull(),
    ends: time('ends').notNull(),
    label: text('label').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('provider_breaks_clinic_id_id_key').on(t.clinicId, t.id),
    foreignKey({
      name: 'provider_breaks_provider_id_fk',
      columns: [t.clinicId, t.providerId],
      foreignColumns: [providers.clinicId, providers.id],
    }),
    check('provider_breaks_weekday_check', sql`${t.weekday} between 1 and 7`),
    check('provider_breaks_starts_check', sql`${t.starts} < ${t.ends}`),
  ],
);

/**
 * The clinic's catalogue of treatments. `default_price` is an optional estimate in the currency's
 * minor units, never a bill (D-043). `aftercare_priority` picks the main treatment of a visit that
 * had several (E06).
 */
export const treatmentTypes = pgTable(
  'treatment_types',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    name: text('name').notNull(),
    defaultDurationMin: integer('default_duration_min').notNull(),
    defaultPrice: integer('default_price'),
    needsAftercare: boolean('needs_aftercare').notNull().default(false),
    aftercarePriority: integer('aftercare_priority').notNull().default(0),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique('treatment_types_clinic_id_id_key').on(t.clinicId, t.id),
    check('treatment_types_default_duration_min_check', sql`${t.defaultDurationMin} > 0`),
    check('treatment_types_default_price_check', sql`${t.defaultPrice} >= 0`),
  ],
);

/**
 * A patient's visit with one provider (data-model.md section 2). The statuses are D-018's; how one
 * may change into another is the state machine's (E01-T06). `title` is the label on the calendar.
 * `created_by` is the user who booked it, as `audit_log.actor_id` names the user who acted.
 *
 * No double booking (D-020): migration 0002 adds the exclusion constraint
 * `appointments_no_double_booking`, which drizzle-kit cannot declare. While an appointment is not
 * cancelled or a no-show and `overlap_ok` is false, no other such appointment of the same provider
 * may overlap it. A range holds its start and not its end, so back-to-back visits do not overlap.
 * Staff "book anyway" sets `overlap_ok` on that one appointment.
 *
 * `source_message_id` comes with `messages` (E02-T01, D-091).
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    patientId: uuid('patient_id').notNull(),
    providerId: uuid('provider_id').notNull(),
    treatmentTypeId: uuid('treatment_type_id'),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('booked'),
    overlapOk: boolean('overlap_ok').notNull().default(false),
    source: text('source').notNull(),
    note: text('note').notNull().default(''),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedVia: text('confirmed_via'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('appointments_clinic_id_id_key').on(t.clinicId, t.id),
    foreignKey({
      name: 'appointments_patient_id_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }),
    foreignKey({
      name: 'appointments_provider_id_fk',
      columns: [t.clinicId, t.providerId],
      foreignColumns: [providers.clinicId, providers.id],
    }),
    foreignKey({
      name: 'appointments_treatment_type_id_fk',
      columns: [t.clinicId, t.treatmentTypeId],
      foreignColumns: [treatmentTypes.clinicId, treatmentTypes.id],
    }),
    check('appointments_starts_at_check', sql`${t.startsAt} < ${t.endsAt}`),
    check(
      'appointments_status_check',
      sql`${t.status} in ('booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show')`,
    ),
    check(
      'appointments_source_check',
      sql`${t.source} in ('staff', 'recall_link', 'patient_request', 'walk_in')`,
    ),
    check('appointments_confirmed_via_check', sql`${t.confirmedVia} in ('link', 'staff')`),
    check('appointments_cancelled_by_check', sql`${t.cancelledBy} in ('patient', 'staff')`),
  ],
);
