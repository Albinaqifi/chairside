import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';
import { cookiesAreSecure } from './better-auth';

// E00-T07e (E00-T07a review): cookiesAreSecure() marks the clinic cookie Secure (the clinic picker's
// action, src/app/(auth)/choose-clinic/actions.ts), and must say so exactly when the auth library marks
// its own cookies Secure. The library does not read BETTER_AUTH_URL's `https://` prefix as written: it
// keeps the origin the WHATWG URL parser makes and marks its cookies from that (better-auth 1.7.7,
// dist/context/create-context.mjs and dist/cookies/index.mjs). Asked of the library itself, an in-memory
// instance. The cookie the action sets: tests/integration/action-choose-clinic.test.ts. Every value is
// synthetic.

const HTTPS = 'https://chairside.example.test';
const HTTP = 'http://localhost:3000';
const SECRET = 'a'.repeat(32);

/** The session cookie of the auth library made with `url`, or undefined when it does not start. */
async function librarySessionCookie(url: string) {
  try {
    const auth = betterAuth({
      baseURL: url,
      secret: SECRET,
      database: memoryAdapter({}),
      telemetry: { enabled: false },
      logger: { disabled: true },
    });
    return (await auth.$context).authCookies.sessionToken;
  } catch {
    return undefined;
  }
}

/** Whether the auth library, made with `url`, marks its session cookie Secure; or 'no start'. */
async function libraryCookieSecure(url: string): Promise<boolean | 'no start'> {
  const cookie = await librarySessionCookie(url);
  if (cookie === undefined) return 'no start';
  const secure = cookie.attributes.secure === true;
  expect(cookie.name.startsWith('__Secure-'), 'its name says the same').toBe(secure);
  return secure;
}

/** cookiesAreSecure() while BETTER_AUTH_URL is `url`. */
function clinicCookieSecure(url: string): boolean {
  vi.stubEnv('BETTER_AUTH_URL', url);
  try {
    return cookiesAreSecure();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe('cookiesAreSecure, by which the clinic cookie is Secure', () => {
  it.each([
    { form: 'nothing around it', url: HTTPS },
    { form: 'a space before it', url: ` ${HTTPS}` },
    { form: 'a line break before it', url: `\n${HTTPS}` },
    { form: 'HTTPS://', url: 'HTTPS://chairside.example.test' },
    { form: 'one slash', url: 'https:/chairside.example.test' },
    { form: 'no slash', url: 'https:chairside.example.test' },
    { form: 'a backslash', url: 'https:\\chairside.example.test' },
    { form: 'a tab inside the scheme', url: 'ht\ttps://chairside.example.test' },
  ])(
    'is true for a BETTER_AUTH_URL written with $form, as the library marks its own cookies',
    async ({ url }) => {
      expect(await libraryCookieSecure(url)).toBe(true);
      expect(clinicCookieSecure(url)).toBe(true);
    },
  );

  it.each([
    { form: 'nothing around it', url: HTTP },
    { form: 'a space before it', url: ` ${HTTP}` },
    { form: 'a line break before it', url: `\n${HTTP}` },
    { form: 'HTTP://', url: 'HTTP://localhost:3000' },
    { form: 'one slash', url: 'http:/localhost:3000' },
  ])('is false over http, written with $form, as the library marks its own', async ({ url }) => {
    expect(await libraryCookieSecure(url)).toBe(false);
    expect(clinicCookieSecure(url)).toBe(false);
  });

  it('agrees with the library for every BETTER_AUTH_URL the library starts with', async () => {
    // Built from what a value pasted into a host's settings can carry around and inside its scheme.
    const forms: string[] = [];
    const noBreakSpace = String.fromCharCode(0xa0);
    const byteOrderMark = String.fromCharCode(0xfeff);
    for (const before of ['', ' ', '\n', '\r\n', '\t', noBreakSpace, byteOrderMark])
      for (const scheme of [
        'https',
        'HTTPS',
        'Https',
        'ht\ttps',
        'http',
        'HTTP',
        'blob:https',
        'wss',
      ])
        for (const separator of ['://', ':/', ':', ':\\', ':///'])
          for (const after of ['', '/', '/api/auth', ' ', '\n'])
            forms.push(`${before}${scheme}${separator}chairside.example.test${after}`);
    const library = await Promise.all(forms.map(libraryCookieSecure));

    const disagree = forms.filter(
      (url, i) => library[i] !== 'no start' && library[i] !== clinicCookieSecure(url),
    );
    expect(disagree.map((url) => JSON.stringify(url))).toEqual([]);

    // Not true by default: the library marked many forms each way, and could not start with others.
    for (const kind of [true, false, 'no start'] as const) {
      expect(library.filter((secure) => secure === kind).length, String(kind)).toBeGreaterThan(100);
    }
  });
});
