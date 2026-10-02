import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newId } from '@/lib/ids';
import { clinics } from '@/modules/tenancy/schema'; // for the foreign key only (D-058)

/**
 * Append-only record of who did what. The app role may insert and read rows, never update or
 * delete them (migration 0000). `metadata` holds ids and field names only, never the values of
 * personal fields.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    clinicId: uuid('clinic_id')
      .notNull()
      .references(() => clinics.id),
    at: timestamp('at', { withTimezone: true }).notNull(), // when it happened: the caller's "now"
    actorType: text('actor_type').notNull(),
    // Text, not uuid: user ids come from the auth library (E00-T02).
    actorId: text('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('audit_log_clinic_id_id_key').on(t.clinicId, t.id),
    index('audit_log_clinic_id_at_idx').on(t.clinicId, t.at),
    check('audit_log_actor_type_check', sql`${t.actorType} in ('user', 'patient_link', 'system')`),
    check('audit_log_metadata_check', sql`jsonb_typeof(${t.metadata}) = 'object'`),
  ],
);
