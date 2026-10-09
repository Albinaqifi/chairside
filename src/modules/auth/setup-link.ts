import { randomBytes } from 'node:crypto';
import { requiredEnv } from '@/db/required-env';
import { isUuid } from '@/lib/ids';
import { getAuth } from './better-auth';

/** How long a setup link works (owner, D-101). */
export const SETUP_LINK_DAYS = 3;

/**
 * The page a setup link opens, where the person chooses their password: beside the login page,
 * which the request proxy lets through untouched (src/proxy.ts), so no session is needed.
 */
export const SET_PASSWORD_PATH = '/login/set-password';

/** Random bytes in a token: 256 bits, at least 128 (security-privacy.md section 2). */
const TOKEN_BYTES = 32;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Makes a one-time link to the page where the person chooses their own password (D-101), and gives
 * it: BETTER_AUTH_URL, the page's path, then the token after `#`, which a browser never sends, so no
 * request log and no Referer holds it. The page sends the token with the new password to the auth
 * library's `/reset-password`, which sets it, spends the token and ends the person's sessions.
 *
 * The token is the library's own password-reset token for the person, made through its internal
 * adapter as createStaffUser() makes people: random and URL-safe, valid for SETUP_LINK_DAYS from
 * `now`, and stored only as the SHA-256 hash of its identifier (`verification.storeIdentifier`,
 * better-auth.ts). The link is a secret: the caller hands it to the person and nowhere else, never
 * to a logger.
 */
export async function createSetupLink(userId: string, now: Date): Promise<string> {
  if (!isUuid(userId)) throw new TypeError('createSetupLink: userId must be a UUID');
  if (Number.isNaN(now.getTime())) throw new TypeError('createSetupLink: now must be a valid Date');
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(now.getTime() + SETUP_LINK_DAYS * DAY_MS),
  });
  const link = new URL(SET_PASSWORD_PATH, requiredEnv('BETTER_AUTH_URL'));
  link.hash = token;
  return link.href;
}
