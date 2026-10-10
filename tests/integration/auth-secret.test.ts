import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/[...all]/route';
import { closeDb } from '@/db/client';
import {
  AUTH_SECRET_MIN_LENGTH,
  createStaffUser,
  EXAMPLE_AUTH_SECRET,
  getAuth,
} from '@/modules/auth';
import { migratorPool, testEmail } from './fixtures';

// E00-T07a, acceptance 6 (E00-T02 review): with BETTER_AUTH_URL on https, .env.example's secret and
// one of 31 characters are refused. The auth library never starts with them, so a sign-in through
// the app's own route for it (src/app/api/auth/[...all]/route.ts), as the login form sends it, makes
// no session. Over http the logins work as before; the seed's own, in a browser: J1
// (tests/e2e/j1.spec.ts). The health check's 503: health.test.ts. Every value is synthetic; the
// password is a marker.

const HTTPS_ORIGIN = 'https://chairside.example.test';
const HTTP_ORIGIN = 'http://localhost:3000'; // BETTER_AUTH_URL in vitest.config.ts
const PASSWORD = 'MARKER-pw-5b8e-correct';
const SHORT_SECRET = `MARKER-${'s'.repeat(AUTH_SECRET_MIN_LENGTH - 8)}`; // 31 characters
const LONG_ENOUGH_SECRET = `${SHORT_SECRET}s`; // 32 characters

const admin = migratorPool();
let email: string;
let userId: string;

let nextAddress = 1;
/** A client address no other test has used, so rate-limit counters never cross tests. */
const freshAddress = () => `10.42.0.${nextAddress++}`;

/**
 * The auth library is made on first use, with the settings of that moment, and kept on globalThis
 * (better-auth.ts). Forgotten here, so the next use makes it again with the settings a test names.
 */
function forgetAuth(): void {
  delete (globalThis as { chairsideAuth?: unknown }).chairsideAuth;
}

/** The auth settings for the rest of a test. */
function authSettings(origin: string, secret: string): void {
  vi.stubEnv('BETTER_AUTH_URL', origin);
  vi.stubEnv('BETTER_AUTH_SECRET', secret);
  forgetAuth();
}

beforeAll(async () => {
  email = testEmail();
  ({ id: userId } = await createStaffUser({ email, name: 'Test Staff', password: PASSWORD }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  forgetAuth();
});

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** Signs the person in at `origin` through the app's route: its answer, or the error it threw. */
async function signIn(origin: string): Promise<Response | Error> {
  try {
    return await POST(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', 'x-forwarded-for': freshAddress() },
        body: JSON.stringify({ email, password: PASSWORD }),
      }),
    );
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

/** The person's sessions, as the migration role sees them. */
async function sessions(): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'select count(*)::int as n from sessions where user_id = $1',
    [userId],
  );
  return rows[0]!.n;
}

/** What getAuth() threw, or undefined when it made the library. */
function authError(): Error | undefined {
  try {
    getAuth();
    return undefined;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

describe('with BETTER_AUTH_URL on https', () => {
  it.each([
    {
      secret: EXAMPLE_AUTH_SECRET,
      name: "the example secret, .env.example's",
      code: 'auth_secret_example',
    },
    { secret: SHORT_SECRET, name: 'a secret of 31 characters', code: 'auth_secret_short' },
  ])('refuses $name: the library never starts and no session is made', async ({ secret, code }) => {
    authSettings(HTTPS_ORIGIN, secret);
    const before = await sessions();

    const refused = authError();
    expect(refused?.message).toContain(`(${code})`);
    expect(refused?.message, 'the error never holds the secret').not.toContain(secret);

    const answer = await signIn(HTTPS_ORIGIN);
    expect(answer).toBeInstanceOf(Error);
    expect((answer as Error).message).toContain(`(${code})`);
    expect(await sessions(), 'no session').toBe(before);

    // Nothing was kept: every later use is refused too.
    expect(authError()?.message).toContain(`(${code})`);
  });

  it('takes a secret of 32 characters: the same sign-in makes a session', async () => {
    authSettings(HTTPS_ORIGIN, LONG_ENOUGH_SECRET);
    const before = await sessions();
    const answer = await signIn(HTTPS_ORIGIN);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).status).toBe(200);
    expect(await sessions()).toBe(before + 1);
  });
});

describe('with BETTER_AUTH_URL on http, as on this machine and in CI', () => {
  it.each([
    { secret: EXAMPLE_AUTH_SECRET, name: "the example secret, .env.example's" },
    { secret: SHORT_SECRET, name: 'a secret of 31 characters' },
  ])('signs in with $name as before', async ({ secret }) => {
    authSettings(HTTP_ORIGIN, secret);
    const before = await sessions();
    const answer = await signIn(HTTP_ORIGIN);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).status).toBe(200);
    expect(await sessions()).toBe(before + 1);
  });
});

// E00-T07a tester, findings 1 and 2: on https the library never signs with a secret the check
// refuses, whichever setting gives it. It reads BETTER_AUTH_SECRETS itself and signs with its first
// entry in place of BETTER_AUTH_SECRET, so that list is refused whatever it holds (Chairside sets
// none); and the secret is judged without the whitespace a value pasted into a host's settings can
// carry around it, since the library signs with the value as given.
describe('BETTER_AUTH_SECRETS, and whitespace around the secret', () => {
  it.each([
    {
      name: 'BETTER_AUTH_SECRETS holding a short secret',
      secret: LONG_ENOUGH_SECRET,
      secrets: `1:${SHORT_SECRET}`,
      code: 'auth_secrets_set',
    },
    {
      name: "BETTER_AUTH_SECRETS holding .env.example's secret",
      secret: LONG_ENOUGH_SECRET,
      secrets: `1:${EXAMPLE_AUTH_SECRET}`,
      code: 'auth_secrets_set',
    },
    {
      name: "BETTER_AUTH_SECRET set to .env.example's secret and a space",
      secret: `${EXAMPLE_AUTH_SECRET} `,
      secrets: undefined,
      code: 'auth_secret_example',
    },
    {
      name: "BETTER_AUTH_SECRET set to .env.example's secret and a newline",
      secret: `${EXAMPLE_AUTH_SECRET}\n`,
      secrets: undefined,
      code: 'auth_secret_example',
    },
  ])(
    'refuses, on https, $name: the library never starts and no session is made',
    async ({ secret, secrets, code }) => {
      authSettings(HTTPS_ORIGIN, secret);
      if (secrets !== undefined) vi.stubEnv('BETTER_AUTH_SECRETS', secrets);
      const before = await sessions();

      const refused = authError();
      expect(refused?.message).toContain(`(${code})`);
      for (const value of [SHORT_SECRET, EXAMPLE_AUTH_SECRET]) {
        expect(refused?.message, 'the error never holds a secret').not.toContain(value);
      }

      const answer = await signIn(HTTPS_ORIGIN);
      expect(answer).toBeInstanceOf(Error);
      expect((answer as Error).message).toContain(`(${code})`);
      expect(await sessions(), 'no session').toBe(before);

      // Nothing was kept: every later use is refused too.
      expect(authError()?.message).toContain(`(${code})`);
    },
  );

  it('takes BETTER_AUTH_SECRETS over http as before: the library signs in with it', async () => {
    authSettings(HTTP_ORIGIN, LONG_ENOUGH_SECRET);
    vi.stubEnv('BETTER_AUTH_SECRETS', `1:${SHORT_SECRET}`);
    const before = await sessions();
    const answer = await signIn(HTTP_ORIGIN);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).status).toBe(200);
    expect(await sessions()).toBe(before + 1);
  });
});

// E00-T07a tester, fix round 2: the check judges BETTER_AUTH_SECRET alone, so on https the session
// must be signed with exactly that value, never with another setting the library also reads
// (BETTER_AUTH_SECRETS, refused above; AUTH_SECRET, which better-auth 1.7.7 takes only when the
// secret it is given is empty). The session cookie is the token, a dot and the token's HMAC-SHA256
// with the signing secret, in base64 (better-call's signCookieValue): recomputed here, it names the
// secret that signed. A library upgrade that signs with another setting turns this red.
describe('the secret that signs the session', () => {
  const STRONG = `MARKER-${'k'.repeat(37)}`; // 44 characters

  /** The session cookie's token and signature, from a sign-in's answer. */
  function sessionCookie(answer: Response): { token: string; signature: string } {
    const value = answer.headers
      .getSetCookie()
      .map((cookie) => /session_token=([^;]+)/.exec(cookie)?.[1])
      .find((found) => found !== undefined);
    expect(value, 'a session cookie').toBeDefined();
    const decoded = decodeURIComponent(value!);
    const dot = decoded.lastIndexOf('.');
    return { token: decoded.slice(0, dot), signature: decoded.slice(dot + 1) };
  }

  const signedWith = (secret: string, token: string) =>
    createHmac('sha256', secret).update(token).digest('base64');

  it("is BETTER_AUTH_SECRET on https, while AUTH_SECRET holds .env.example's", async () => {
    authSettings(HTTPS_ORIGIN, STRONG);
    vi.stubEnv('AUTH_SECRET', EXAMPLE_AUTH_SECRET);
    const answer = await signIn(HTTPS_ORIGIN);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).status).toBe(200);

    const { token, signature } = sessionCookie(answer as Response);
    expect(signature, 'signed with the secret the check judged').toBe(signedWith(STRONG, token));
    expect(signature).not.toBe(signedWith(EXAMPLE_AUTH_SECRET, token));
  });

  it("is BETTER_AUTH_SECRETS' first entry over http, as the refusal on https expects", async () => {
    // The control: the same reading names another secret when the library signs with one.
    authSettings(HTTP_ORIGIN, LONG_ENOUGH_SECRET);
    vi.stubEnv('BETTER_AUTH_SECRETS', `1:${SHORT_SECRET}`);
    const answer = await signIn(HTTP_ORIGIN);
    expect(answer).toBeInstanceOf(Response);

    const { token, signature } = sessionCookie(answer as Response);
    expect(signature).toBe(signedWith(SHORT_SECRET, token));
    expect(signature).not.toBe(signedWith(LONG_ENOUGH_SECRET, token));
  });
});

// E00-T07a critical review, required change 1: the library reads BETTER_AUTH_URL with the WHATWG URL
// parser and keeps the origin it makes, from which its cookies get Secure (better-auth 1.7.7,
// dist/utils/url.mjs and dist/context/create-context.mjs). So a URL with a space or a line break
// before it, written `https:/host`, `https:host` or `https:\host`, or with a tab inside its scheme, is
// https to it, and each meets every refusal: the library never starts and the sign-in from https makes
// no session. The control: with a strong secret the library starts with each form and reads it as
// https (its session cookie `__Secure-` and Secure). Over http, however it is written, as before.
describe('a BETTER_AUTH_URL the auth library reads as https, however it is written', () => {
  const FORMS = [
    { form: 'a space before it', url: ` ${HTTPS_ORIGIN}` },
    { form: 'a line break before it', url: `\n${HTTPS_ORIGIN}` },
    { form: 'one slash', url: 'https:/chairside.example.test' },
    { form: 'no slash', url: 'https:chairside.example.test' },
    { form: 'a backslash', url: 'https:\\chairside.example.test' },
    { form: 'a tab inside the scheme', url: 'ht\ttps://chairside.example.test' },
  ];
  const REFUSALS = [
    {
      refused: "the example secret, .env.example's",
      secret: EXAMPLE_AUTH_SECRET,
      secrets: undefined,
      code: 'auth_secret_example',
    },
    {
      refused: 'a secret of 31 characters',
      secret: SHORT_SECRET,
      secrets: undefined,
      code: 'auth_secret_short',
    },
    {
      refused: 'BETTER_AUTH_SECRETS holding a short secret',
      secret: LONG_ENOUGH_SECRET,
      secrets: `1:${SHORT_SECRET}`,
      code: 'auth_secrets_set',
    },
  ];
  const CASES = FORMS.flatMap((form) => REFUSALS.map((refusal) => ({ ...form, ...refusal })));

  it.each(CASES)(
    'refuses $refused with $form: the library never starts and no session is made',
    async ({ url, secret, secrets, code }) => {
      authSettings(url, secret);
      if (secrets !== undefined) vi.stubEnv('BETTER_AUTH_SECRETS', secrets);
      const before = await sessions();

      const refused = authError();
      expect(refused?.message).toContain(`(${code})`);
      for (const value of [SHORT_SECRET, EXAMPLE_AUTH_SECRET]) {
        expect(refused?.message, 'the error never holds a secret').not.toContain(value);
      }

      const answer = await signIn(HTTPS_ORIGIN);
      expect(answer).toBeInstanceOf(Error);
      expect((answer as Error).message).toContain(`(${code})`);
      expect(await sessions(), 'no session').toBe(before);

      // Nothing was kept: every later use is refused too.
      expect(authError()?.message).toContain(`(${code})`);
    },
  );

  it.each(FORMS)(
    'takes a strong secret with $form, which the library reads as https: a Secure session cookie',
    async ({ url }) => {
      authSettings(url, LONG_ENOUGH_SECRET);
      const before = await sessions();
      const answer = await signIn(HTTPS_ORIGIN);
      expect(answer).toBeInstanceOf(Response);
      expect((answer as Response).status).toBe(200);
      expect(await sessions()).toBe(before + 1);

      const cookie = (answer as Response).headers
        .getSetCookie()
        .find((set) => set.includes('session_token='));
      expect(cookie, 'the cookie of a site served over https').toMatch(/^__Secure-/);
      expect(cookie).toMatch(/;\s*Secure\s*(;|$)/i);
    },
  );

  it.each([
    { form: 'a space before it', url: ` ${HTTP_ORIGIN}` },
    { form: 'a line break before it', url: `\n${HTTP_ORIGIN}` },
    { form: 'one slash', url: 'http:/localhost:3000' },
  ])('signs in over http with $form and the example secret, as before', async ({ url }) => {
    authSettings(url, EXAMPLE_AUTH_SECRET);
    const before = await sessions();
    const answer = await signIn(HTTP_ORIGIN);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).status).toBe(200);
    expect(await sessions()).toBe(before + 1);
  });
});
