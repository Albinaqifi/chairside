import { APIError } from 'better-auth/api';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import * as audit from '@/modules/audit';
import { clinicsForUser } from './memberships';

/** What the login audit reads from the session the auth library has just stored. */
export interface NewSession {
  userId: string;
  /** When the session started: the row's "now". */
  createdAt: Date;
}

/**
 * Writes `user.logged_in` to the audit log of every clinic where the person has an active
 * membership (D-064, point 4; security-privacy.md, section 10). One withTenant per clinic, one after
 * another, so each row is written inside its own clinic. `at` is the session's start; actor and
 * entity are the user. Nothing else goes in the row: no address, user agent, email or token. A
 * person without an active membership gets no row.
 *
 * The auth library calls this as `databaseHooks.session.create.after`: after it has stored the new
 * session and before it sets the cookie (D-071). When a row cannot be written, the failure is
 * logged with ids, and this throws the library's own error, so the sign-in answers 500 and no
 * cookie reaches the browser (the person reads "Login did not work"). Rows already written in
 * other clinics stay: each clinic's transaction is its own. The session row the library stored is
 * never sent to anyone and ends after 30 minutes.
 */
export async function recordLogin(session: NewSession): Promise<void> {
  let clinicId: string | undefined;
  try {
    for (const clinic of await clinicsForUser(session.userId)) {
      clinicId = clinic.clinicId;
      await withTenant(clinic.clinicId, (tx) =>
        audit.record(tx, {
          at: session.createdAt,
          actorType: 'user',
          actorId: session.userId,
          action: 'user.logged_in',
          entityType: 'user',
          entityId: session.userId,
        }),
      );
    }
  } catch (error) {
    // Logged here, once, with the ids. What is thrown carries none of it: an error of another
    // kind the library would print again (its logger and console.error), and the body of an
    // APIError is sent to the browser as it is.
    logger.error(
      { err: error, userId: session.userId, clinicId },
      'login audit: the login rows could not be written; the sign-in is refused',
    );
    throw new APIError('INTERNAL_SERVER_ERROR', {
      message: 'The sign-in could not be completed.',
    });
  }
}
