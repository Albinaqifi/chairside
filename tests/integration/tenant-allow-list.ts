/**
 * The only tables that are not ordinary tenant tables. Every other table must have a
 * `clinic_id uuid not null` column, Row-Level Security enabled, and policies that compare
 * `clinic_id` with current_clinic_id(). The meta-test (tenant-tables.test.ts) enforces this.
 *
 * Adding an entry is a critical change: give the reason here and in the handoff note.
 */

/**
 * Global tables: no clinic and no Row-Level Security. The app role reaches only the auth
 * library's tables among them (migration 0001), nothing else.
 */
export const GLOBAL_TABLES: Readonly<Record<string, string>> = {
  'drizzle.__drizzle_migrations': 'Migration journal, written by the migration role only.',
  'public.users':
    'Staff identities, managed by the auth library (D-006). One person can belong to several clinics, so a user is not inside one clinic; what they may do in a clinic is in `memberships`, a tenant table.',
  'public.sessions':
    'Login sessions of the auth library. A session belongs to a user; the clinic is resolved from `memberships` on every request (D-062).',
  'public.accounts': 'The auth library’s credentials per user: the password hash.',
  'public.verifications': 'The auth library’s one-time tokens (password reset, E04).',
  'public.rate_limits':
    'Request counters for the login rate limit, by client address and path, written by the auth library.',
};

/** Tables that are the tenant itself: their own `id` is the clinic id, and the policy compares it. */
export const TENANT_ROOT_TABLES: Readonly<Record<string, string>> = {
  'public.clinics': 'The tenant.',
};

/**
 * SECURITY DEFINER functions, by `schema.name`: the few named database functions that may look
 * across clinics (security-privacy.md, section 1). They run with their owner's rights, so
 * Row-Level Security does not limit them. Views must be `security_invoker`, and materialized
 * views are not allowed: neither has an allow-list (tenant-tables.test.ts).
 */
export const CROSS_CLINIC_FUNCTIONS: Readonly<Record<string, string>> = {
  'public.clinics_for_user':
    'Lists the clinics one user has an active membership in, for login and the clinic picker (E00-T02, D-062). Takes the user id; returns membership id, clinic id, clinic name, role and extra permissions, nothing else.',
};
