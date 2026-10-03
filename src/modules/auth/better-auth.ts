import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from '@/db/client';
import { requiredEnv } from '@/db/required-env';
import { AUTH_COOKIE_PREFIX } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { accounts, rateLimits, sessions, users, verifications } from './schema';

/**
 * The auth library (Better Auth, D-006): passwords, sessions and cookies are never hand-made.
 * It is the one place that reaches the database outside withTenant, because its tables are
 * global (schema.ts). Everything about a clinic stays in `memberships`, behind Row-Level Security.
 */

/** A session ends after this long without a request (security-privacy.md, section 2). */
export const SESSION_IDLE_SECONDS = 30 * 60;

/**
 * How often an active session's expiry is moved forward. Each move is a database write, so it
 * is not done on every request: a session can end up to this long before the 30 minutes.
 */
export const SESSION_REFRESH_SECONDS = 60;

/**
 * Sign-in requests allowed per client address in one window (seconds). Every request counts,
 * successful ones too, and a clinic's computers usually share one address, so the limit leaves
 * room for a whole team logging in within a minute while still making guessing slow (D-064, R-33).
 */
export const SIGN_IN_RATE_LIMIT = { window: 60, max: 10 } as const;

function createAuth() {
  return betterAuth({
    appName: 'Chairside',
    // Also the only trusted origin for cookie-bearing requests, and what makes cookies Secure
    // (https). Required, so nothing is ever inferred from request headers.
    baseURL: requiredEnv('BETTER_AUTH_URL'),
    secret: requiredEnv('BETTER_AUTH_SECRET'),
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications, rateLimits },
    }),
    emailAndPassword: {
      enabled: true,
      // No self sign-up: clinics are set up by hand (intent.md). Users come from the seed, the
      // operator script (E00-T05) and invites (E04), all through createStaffUser().
      disableSignUp: true,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
    },
    rateLimit: {
      // On in every environment, not only in production, so tests and local runs see it.
      enabled: true,
      // Counters in the database: shared by every web instance, kept across restarts.
      storage: 'database',
      customRules: { '/sign-in/email': SIGN_IN_RATE_LIMIT },
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      // Our ids everywhere (CLAUDE.md), so the tables can use uuid columns.
      database: { generateId: () => newId() },
    },
    // The library's own log lines go through our logger, which drops personal fields.
    logger: {
      log: (level, message, ...details) =>
        logger[level]({ details, library: 'better-auth' }, message),
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

// One instance per process, kept on globalThis so hot reloads in development reuse it. Created
// on first use, so importing the module needs no environment (unit tests, lint).
const state = globalThis as typeof globalThis & { chairsideAuth?: Auth };

export function getAuth(): Auth {
  state.chairsideAuth ??= createAuth();
  return state.chairsideAuth;
}

/** True when the app is reached over https, so cookies we set ourselves are marked Secure too. */
export function cookiesAreSecure(): boolean {
  return requiredEnv('BETTER_AUTH_URL').startsWith('https://');
}
