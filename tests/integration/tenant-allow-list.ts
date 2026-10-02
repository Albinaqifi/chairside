/**
 * The only tables that are not ordinary tenant tables. Every other table must have a
 * `clinic_id uuid not null` column, Row-Level Security enabled, and policies that compare
 * `clinic_id` with current_clinic_id(). The meta-test (tenant-tables.test.ts) enforces this.
 *
 * Adding an entry is a critical change: give the reason here and in the handoff note.
 */

/** Global tables: no clinic and no Row-Level Security. The app role has no access to them. */
export const GLOBAL_TABLES: Readonly<Record<string, string>> = {
  'drizzle.__drizzle_migrations': 'Migration journal, written by the migration role only.',
};

/** Tables that are the tenant itself: their own `id` is the clinic id, and the policy compares it. */
export const TENANT_ROOT_TABLES: Readonly<Record<string, string>> = {
  'public.clinics': 'The tenant.',
};
