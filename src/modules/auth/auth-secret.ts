/**
 * The auth library's secret signs the session cookie (D-006). `.env.example` holds one for this
 * machine, committed and so no secret (D-064, point 2): a host that copied it, or set a short one,
 * would sign every session with a value anyone can read or guess. Over https, which is how a host
 * serves the app, such a secret is refused: the auth library never starts with it (better-auth.ts),
 * so no session is made, and the web's health check fails (src/app/api/health/route.ts, D-102).
 * Over http (this machine, CI) nothing changes (E00-T07a, E00-T02 review).
 */

/**
 * `.env.example`'s BETTER_AUTH_SECRET. The image holds no `.env.example` to read it from, so it is
 * written here too; a unit test keeps the two the same (auth-secret.test.ts).
 */
export const EXAMPLE_AUTH_SECRET = 'WvmU7awnhS+hURz48Xzur7L/WDwpIn2OzurTHxKrCr0=';

/** The shortest secret taken over https, in characters. */
export const AUTH_SECRET_MIN_LENGTH = 32;

/** Why a secret is refused over https, as a code: never the secret itself. */
export type AuthSecretRefusal = 'auth_secret_example' | 'auth_secret_short';

/** Why the auth library's settings cannot be used, as a code: one missing, or a refused secret. */
export type AuthSettingsProblem = 'auth_settings_missing' | AuthSecretRefusal;

/** What each refusal means, for the error that stops the auth library; the code is added to it. */
export const AUTH_SECRET_REFUSALS: Record<AuthSecretRefusal, string> = {
  auth_secret_example: "BETTER_AUTH_SECRET is .env.example's, which anyone can read",
  auth_secret_short: `BETTER_AUTH_SECRET is shorter than ${AUTH_SECRET_MIN_LENGTH} characters`,
};

/**
 * Why `secret` is refused for an app reached at `url`, or null: over https, the example secret or
 * one shorter than AUTH_SECRET_MIN_LENGTH. A URL's scheme has no case, so `HTTPS://` is https too.
 */
export function authSecretRefusal(url: string, secret: string): AuthSecretRefusal | null {
  if (!/^https:\/\//i.test(url)) return null;
  if (secret === EXAMPLE_AUTH_SECRET) return 'auth_secret_example';
  if (secret.length < AUTH_SECRET_MIN_LENGTH) return 'auth_secret_short';
  return null;
}

/**
 * Whether the auth library can start with the settings of `env` (the process's): null when it can,
 * otherwise why not. For the health check, which must not start the library to find out.
 */
export function authSettingsProblem(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthSettingsProblem | null {
  const url = env.BETTER_AUTH_URL;
  const secret = env.BETTER_AUTH_SECRET;
  if (!url || !secret) return 'auth_settings_missing';
  return authSecretRefusal(url, secret);
}
