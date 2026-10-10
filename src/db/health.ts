import type pg from 'pg';
import { connect } from './client';

/**
 * The database's part of the web's health check (src/app/api/health/route.ts, D-102): the database
 * answers through DATABASE_URL, the app's own pool, and that login cannot get past the Row-Level
 * Security policies. A hosted DATABASE_URL that named the tables' owner would switch every policy off
 * without an error (E00-T01 review), so a host never puts such a web live: its check fails.
 */

/** Why the database's part fails, as a code. */
export type DatabaseProblem = 'database_unreachable' | 'database_login_past_policies';

/**
 * True when the login gets past the policies, at once or with one `SET ROLE`: it is, or is a member
 * of, a role that is a superuser, has BYPASSRLS, or owns a table that has Row-Level Security on (an
 * owner skips its policies, and can switch them off). Membership of any kind counts ('MEMBER'): one
 * that inherits has the owner's privileges at once ('USAGE'), one that does not can still SET ROLE to
 * it. A role is a member of itself. Asked of the roles themselves, never by comparing names.
 */
const LOGIN_PAST_POLICIES = `
  select exists (
           select 1 from pg_roles
            where (rolsuper or rolbypassrls) and pg_has_role(current_user, oid, 'MEMBER')
         )
      or exists (
           select 1 from pg_class
            where relkind in ('r', 'p') and relrowsecurity
              and pg_has_role(current_user, relowner, 'MEMBER')
         ) as past_policies`;

/**
 * Asks the database through the app's pool: null when it answers and the login cannot get past the
 * policies; otherwise the problem, with the error when there was one. It throws nothing, and waits
 * for a connection as long as the pool lets anything wait (CONNECTION_TIMEOUT_MS, client.ts).
 */
export async function databaseProblem(): Promise<{
  code: DatabaseProblem;
  cause?: unknown;
} | null> {
  let client: pg.PoolClient;
  try {
    client = await connect();
  } catch (cause) {
    return { code: 'database_unreachable', cause };
  }
  try {
    const { rows } = await client.query<{ past_policies: boolean }>(LOGIN_PAST_POLICIES);
    client.release();
    // Anything but a clear "no" fails the check.
    return rows[0]?.past_policies === false ? null : { code: 'database_login_past_policies' };
  } catch (cause) {
    // The connection may have failed with the query: it is closed, never pooled again.
    client.release(true);
    return { code: 'database_unreachable', cause };
  }
}
