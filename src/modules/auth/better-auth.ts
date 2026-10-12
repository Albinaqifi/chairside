import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getDb } from '@/db/client';
import { requiredEnv } from '@/db/required-env';
import { AUTH_COOKIE_PREFIX } from '@/lib/cookies';
import { newId } from '@/lib/ids';
import { logger } from '@/lib/logger';
import { withoutQueryValues } from '@/lib/query-errors';
import {
  AUTH_SECRET_MIN_LENGTH,
  AUTH_SECRET_REFUSALS,
  authSecretRefusal,
  readAsHttps,
} from './auth-secret';
import { recordLogin } from './login-audit';
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

/**
 * How long a password may be, in characters: the library's own defaults, named so the page where a
 * person chooses theirs can say it (E00-T05b). The library checks it whenever a password is set.
 */
export const PASSWORD_LENGTH = { min: 8, max: 128 } as const;

/**
 * The library's routes that check a password. Each is limited like sign-in, so no route lets
 * anyone guess a password faster (the library's defaults are 100 per 10 seconds for
 * `/verify-password` and 3 per 10 seconds for `/change-password`). Counters are per address and
 * path.
 */
const PASSWORD_CHECK_PATHS = ['/sign-in/email', '/verify-password', '/change-password'] as const;

type AdapterFactory = ReturnType<typeof drizzleAdapter>;

/**
 * The library's database adapter, with every error it throws made safe to print. The library's
 * router writes an unexpected error to the console itself (better-call), outside our logger, and
 * Next.js prints an error that escapes. A failed query's error carries the values the query was
 * sent: an email typed into the form, or a new session's token, address and user agent
 * (security-privacy.md, section 6).
 */
function withSafeQueryErrors(createAdapter: AdapterFactory): AdapterFactory {
  return (options) => {
    const adapter = createAdapter(options);
    // Changed in place, not wrapped: the library finds its schema check by this very object.
    for (const [name, method] of Object.entries(adapter)) {
      if (typeof method !== 'function') continue;
      const original = method as (...args: unknown[]) => Promise<unknown>;
      Object.assign(adapter, {
        [name]: async (...args: unknown[]) => {
          try {
            return await original.apply(adapter, args);
          } catch (error) {
            throw withoutQueryValues(error);
          }
        },
      });
    }
    return adapter;
  };
}

/**
 * Refuses a sign-in that asks not to be remembered. The library gives such a session a fixed 24
 * hours that are never moved forward, so it would outlive the 30 minutes without a request that
 * every session must end after (security-privacy.md, section 2). Our login form never asks.
 */
const refuseDontRememberMe = createAuthMiddleware(async (ctx) => {
  const body: unknown = ctx.body;
  if (
    ctx.path === '/sign-in/email' &&
    typeof body === 'object' &&
    body !== null &&
    'rememberMe' in body &&
    body.rememberMe === false
  ) {
    throw new APIError('BAD_REQUEST', {
      message:
        'Every session ends after 30 minutes without a request; rememberMe is not supported.',
    });
  }
});

function createAuth() {
  const baseURL = requiredEnv('BETTER_AUTH_URL');
  const secret = requiredEnv('BETTER_AUTH_SECRET');
  // Over https, never with .env.example's secret or a short one, nor with BETTER_AUTH_SECRETS, which
  // the library reads from the environment itself and would sign with instead; over http too, never
  // with BETTER_AUTH_TRUSTED_ORIGINS, which it also reads itself and would take a sign-in from
  // (auth-secret.ts). Thrown before the library exists, so it never starts with them and no session
  // is made; getAuth() keeps nothing, so every later call is refused too. The error names the code,
  // never a secret or an origin.
  const refused = authSecretRefusal(
    baseURL,
    secret,
    process.env.BETTER_AUTH_SECRETS,
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  );
  if (refused === 'auth_trusted_origins_set') {
    throw new Error(
      `${AUTH_SECRET_REFUSALS[refused]}: the auth library does not start, over http as over ` +
        `https. Remove BETTER_AUTH_TRUSTED_ORIGINS from the host's settings: BETTER_AUTH_URL is ` +
        `the only origin a sign-in may come from (${refused}).`,
    );
  }
  if (refused !== null) {
    throw new Error(
      `${AUTH_SECRET_REFUSALS[refused]}, and BETTER_AUTH_URL is https: the auth library does not ` +
        `start. Set BETTER_AUTH_SECRET on the host to a random secret of at least ` +
        `${AUTH_SECRET_MIN_LENGTH} characters, for example from \`openssl rand -base64 32\`, and ` +
        `no BETTER_AUTH_SECRETS (${refused}).`,
    );
  }
  return betterAuth({
    appName: 'Chairside',
    // Also the only trusted origin for cookie-bearing requests, and what makes cookies Secure
    // (https). Required, so nothing is ever inferred from request headers.
    baseURL,
    secret,
    database: withSafeQueryErrors(
      drizzleAdapter(getDb(), {
        provider: 'pg',
        usePlural: true,
        schema: { users, sessions, accounts, verifications, rateLimits },
      }),
    ),
    emailAndPassword: {
      enabled: true,
      // No self sign-up: clinics are set up by hand (intent.md). Users come from the seed
      // (E00-T05a), the operator script (E00-T05b) and invites (E04), all through
      // createStaffUser().
      disableSignUp: true,
      minPasswordLength: PASSWORD_LENGTH.min,
      maxPasswordLength: PASSWORD_LENGTH.max,
      // A setup link (E00-T05b) is a password reset: when it is used, every session the person has
      // ends.
      revokeSessionsOnPasswordReset: true,
    },
    // One-time tokens (a setup link's, D-101) are stored as the SHA-256 hash of their identifier
    // (`reset-password:` and the token), never the token itself: a copy of the table opens nothing.
    // The library hashes what it is given the same way when it looks a token up or spends it.
    verification: { storeIdentifier: 'hashed' },
    session: {
      expiresIn: SESSION_IDLE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
    },
    // Every new session writes `user.logged_in` in the person's clinics, before its cookie is set:
    // if that fails, so does the sign-in (login-audit.ts).
    databaseHooks: { session: { create: { after: recordLogin } } },
    hooks: { before: refuseDontRememberMe },
    rateLimit: {
      // On in every environment, not only in production, so tests and local runs see it.
      enabled: true,
      // Counters in the database: shared by every web instance, kept across restarts.
      storage: 'database',
      customRules: Object.fromEntries(
        PASSWORD_CHECK_PATHS.map((path) => [path, SIGN_IN_RATE_LIMIT]),
      ),
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

/**
 * True when the app is reached over https, so cookies we set ourselves are marked Secure too. Read as
 * the auth library reads BETTER_AUTH_URL (readAsHttps, auth-secret.ts), so the clinic cookie is Secure
 * exactly when the library's own are, however the URL is written: ` https://…`, `HTTPS://…` and
 * `https:/host` too (E00-T07a review, E00-T07e).
 */
export function cookiesAreSecure(): boolean {
  return readAsHttps(requiredEnv('BETTER_AUTH_URL'));
}
