/**
 * The auth library's secret signs the session cookie (D-006). `.env.example` holds one for this
 * machine, committed and so no secret (D-064, point 2): a host that copied it, or set a short one,
 * would sign every session with a value anyone can read or guess. Over https, which is how a host
 * serves the app, such a secret is refused: the auth library never starts with it (better-auth.ts),
 * so no session is made, and the web's health check fails (src/app/api/health/route.ts, D-102).
 * So is BETTER_AUTH_SECRETS, a list the library reads itself and would sign with in place of
 * BETTER_AUTH_SECRET. Over http (this machine, CI) nothing changes (E00-T07a, E00-T02 review).
 */

/**
 * `.env.example`'s BETTER_AUTH_SECRET. The image holds no `.env.example` to read it from, so it is
 * written here too; a unit test keeps the two the same (auth-secret.test.ts).
 */
export const EXAMPLE_AUTH_SECRET = 'WvmU7awnhS+hURz48Xzur7L/WDwpIn2OzurTHxKrCr0=';

/** The shortest secret taken over https, in characters. */
export const AUTH_SECRET_MIN_LENGTH = 32;

/** Why a secret is refused over https, as a code: never the secret itself. */
export type AuthSecretRefusal = 'auth_secret_example' | 'auth_secret_short' | 'auth_secrets_set';

/** Why the auth library's settings cannot be used, as a code: one missing, or a refused secret. */
export type AuthSettingsProblem = 'auth_settings_missing' | AuthSecretRefusal;

/** What each refusal means, for the error that stops the auth library; the code is added to it. */
export const AUTH_SECRET_REFUSALS: Record<AuthSecretRefusal, string> = {
  auth_secret_example: "BETTER_AUTH_SECRET is .env.example's, which anyone can read",
  auth_secret_short: `BETTER_AUTH_SECRET is shorter than ${AUTH_SECRET_MIN_LENGTH} characters`,
  auth_secrets_set:
    'BETTER_AUTH_SECRETS is set, and the auth library would sign with its first entry, which ' +
    'nothing checks, in place of BETTER_AUTH_SECRET',
};

/**
 * Whether the auth library reads `url` (BETTER_AUTH_URL) as https. It reads it with the WHATWG URL
 * parser and keeps the origin the parser makes, from which its cookies get Secure (better-auth 1.7.7,
 * dist/utils/url.mjs and dist/context/create-context.mjs). That parser drops spaces and control
 * characters before the URL and tabs and line breaks anywhere in it, reads the scheme without its
 * case, and takes `https:/host`, `https:host` and `https:\host` for `https://host`: so the same parser
 * decides here (E00-T07a critical review). `URL.parse` answers null for what it cannot read, and so
 * never puts the value in an error. A URL written `https://` that it cannot read (`https://` alone)
 * still counts, as before: the library does not start with it either.
 */
function readAsHttps(url: string): boolean {
  return URL.parse(url)?.protocol === 'https:' || /^https:\/\//i.test(url);
}

/**
 * Why the auth library's secret is refused for an app reached at `url`, or null. Over https, as the
 * library reads `url` (readAsHttps): when `secret` (BETTER_AUTH_SECRET) is the example or shorter
 * than AUTH_SECRET_MIN_LENGTH, or when `secrets` (BETTER_AUTH_SECRETS, which the library reads from
 * the environment itself) is set.
 */
export function authSecretRefusal(
  url: string,
  secret: string,
  secrets?: string,
): AuthSecretRefusal | null {
  if (!readAsHttps(url)) return null;
  // Judged without the whitespace around it: a value pasted into a host's settings can carry a space
  // or a line break, and the library signs with the value as given (E00-T07a tester, finding 2).
  const value = secret.trim();
  if (value === EXAMPLE_AUTH_SECRET) return 'auth_secret_example';
  if (value.length < AUTH_SECRET_MIN_LENGTH) return 'auth_secret_short';
  // The library signs with the list's first entry in place of `secret`, and keeps the others to
  // decrypt what they encrypted (better-auth 1.7.7, dist/context/create-context.mjs). Chairside sets
  // no such list, so whatever it holds is refused; an empty one the library reads as not set, and so
  // do we (E00-T07a tester, finding 1).
  if (secrets) return 'auth_secrets_set';
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
  return authSecretRefusal(url, secret, env.BETTER_AUTH_SECRETS);
}
