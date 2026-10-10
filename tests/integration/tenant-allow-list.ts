/**
 * The only tables that are not ordinary tenant tables. Every other table must have a
 * `clinic_id uuid not null` column, Row-Level Security enabled, and policies that compare
 * `clinic_id` with current_clinic_id(). The meta-test (tenant-tables.test.ts) enforces this.
 *
 * Adding an entry is a critical change: give the reason here and in the handoff note.
 */

/**
 * Global tables: no clinic and no Row-Level Security. The app role reaches the auth library's
 * tables among them (migration 0001) and the rows of seven of the job queue's (migration 0005),
 * nothing else.
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
  // The job queue, pg-boss's own tables (D-005, D-102, D-104), made by migration 0005 with fixed names:
  // shared by every clinic, so a job's data holds ids and codes only, and its handler works inside its
  // clinic's tenant transaction (security-privacy.md, section 1).
  'pgboss.version':
    'The job queue’s schema version (45) and when its passes last ran (schedules, maintenance): no row of any clinic’s.',
  'pgboss.queue':
    'The job queues by name, with their settings and counts: one queue serves every clinic.',
  'pgboss.schedule':
    'Recurring jobs (the worker’s heartbeat): a queue name, a cron expression and data that holds ids and codes only.',
  'pgboss.job':
    'Every job, partitioned by queue name: data holds ids and codes only, never a patient’s details, and a failed job keeps the code `job_failed`, never its error (D-104).',
  'pgboss.job_common':
    'The default partition of `pgboss.job`, which holds every queue’s jobs: no queue has a table of its own (D-104).',
  'pgboss.job_dependency':
    'Which job waits for which (pg-boss’s flows): queue names and job ids only.',
  'pgboss.instance':
    'The worker processes running pg-boss: host, process id, versions, the options they run with (no connection string) and pool counts.',
  'pgboss.subscription':
    'pg-boss’s publish and subscribe: not used by Chairside, no grant to the app role.',
  'pgboss.bam':
    'pg-boss’s index builds after an upgrade: not used (it runs with `migrate: false`), no grant to the app role.',
  'pgboss.warning':
    'pg-boss’s stored warnings: not used (none kept, D-104), no grant to the app role.',
  'pgboss.queue_stats':
    'pg-boss’s queue statistics, partitioned by day: not used (no statistics, D-104), no partition exists and no grant to the app role.',
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
    'Lists the clinics one user has an active membership in, for login, the clinic picker, the sidebar and the action wrapper (E00-T02, D-062, D-091). Takes the user id; returns membership id, clinic id, clinic name, role, extra permissions and the kind of the provider the membership is linked to in its own clinic (or null), nothing else.',
};
