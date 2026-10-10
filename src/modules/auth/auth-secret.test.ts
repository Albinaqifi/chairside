import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_SECRET_MIN_LENGTH,
  AUTH_SECRET_REFUSALS,
  authSecretRefusal,
  authSettingsProblem,
  EXAMPLE_AUTH_SECRET,
} from './auth-secret';

// E00-T07a (E00-T02 review): over https, .env.example's secret and one shorter than 32 characters are
// refused; over http (this machine, CI) nothing changes. That the auth library then never starts and
// makes no session, and that the health check answers 503: tests/integration/auth-secret.test.ts and
// tests/integration/health.test.ts. Every value here is synthetic.

const HTTPS = 'https://chairside.example.test';
const HTTP = 'http://localhost:3000';
const SHORT = 'a'.repeat(AUTH_SECRET_MIN_LENGTH - 1); // 31 characters
const LONG_ENOUGH = 'a'.repeat(AUTH_SECRET_MIN_LENGTH); // 32 characters

describe('the example secret', () => {
  it("is .env.example's, which the image cannot read", () => {
    const file = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    expect(parseEnv(file).BETTER_AUTH_SECRET).toBe(EXAMPLE_AUTH_SECRET);
  });

  it('is long enough, so only its value refuses it', () => {
    expect(EXAMPLE_AUTH_SECRET.length).toBeGreaterThanOrEqual(AUTH_SECRET_MIN_LENGTH);
  });

  it("is the one the runbook's commands set, so a copy of them on https is refused", () => {
    // docs/runbook.md runs the image here, over http. A command copied to a host with an https
    // BETTER_AUTH_URL must meet the refusal, never sign sessions with a committed secret it takes.
    const runbook = readFileSync(new URL('../../../docs/runbook.md', import.meta.url), 'utf8');
    const secrets = [...runbook.matchAll(/BETTER_AUTH_SECRET=(\S*)/g)].map(([, secret]) => secret);
    expect(secrets.length).toBeGreaterThan(0);
    for (const secret of secrets) {
      expect(authSecretRefusal(HTTPS, secret ?? '')).toBe('auth_secret_example');
    }
  });
});

describe('authSecretRefusal', () => {
  it('refuses, over https, the example secret and one of 31 characters', () => {
    expect(authSecretRefusal(HTTPS, EXAMPLE_AUTH_SECRET)).toBe('auth_secret_example');
    expect(authSecretRefusal(HTTPS, SHORT)).toBe('auth_secret_short');
    expect(authSecretRefusal(HTTPS, '')).toBe('auth_secret_short');
  });

  it('takes, over https, a secret of 32 characters that is not the example', () => {
    expect(authSecretRefusal(HTTPS, LONG_ENOUGH)).toBeNull();
    expect(authSecretRefusal(`${HTTPS}:8443/`, `${LONG_ENOUGH}more`)).toBeNull();
  });

  it('reads the scheme without its case: HTTPS:// is https too', () => {
    expect(authSecretRefusal('HTTPS://chairside.example.test', EXAMPLE_AUTH_SECRET)).toBe(
      'auth_secret_example',
    );
    expect(authSecretRefusal('Https://chairside.example.test', SHORT)).toBe('auth_secret_short');
  });

  it('changes nothing over http: this machine and CI keep their secrets', () => {
    expect(authSecretRefusal(HTTP, EXAMPLE_AUTH_SECRET)).toBeNull();
    expect(authSecretRefusal(HTTP, SHORT)).toBeNull();
    expect(authSecretRefusal('http://chairside.example.test', 'x')).toBeNull();
  });
});

describe('authSettingsProblem', () => {
  it('names a setting that is missing or empty', () => {
    expect(authSettingsProblem({ BETTER_AUTH_SECRET: LONG_ENOUGH })).toBe('auth_settings_missing');
    expect(authSettingsProblem({ BETTER_AUTH_URL: HTTPS })).toBe('auth_settings_missing');
    expect(authSettingsProblem({ BETTER_AUTH_URL: HTTP, BETTER_AUTH_SECRET: '' })).toBe(
      'auth_settings_missing',
    );
  });

  it("gives the secret's refusal, or null", () => {
    expect(
      authSettingsProblem({ BETTER_AUTH_URL: HTTPS, BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET }),
    ).toBe('auth_secret_example');
    expect(authSettingsProblem({ BETTER_AUTH_URL: HTTPS, BETTER_AUTH_SECRET: SHORT })).toBe(
      'auth_secret_short',
    );
    expect(
      authSettingsProblem({ BETTER_AUTH_URL: HTTPS, BETTER_AUTH_SECRET: LONG_ENOUGH }),
    ).toBeNull();
    expect(
      authSettingsProblem({ BETTER_AUTH_URL: HTTP, BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET }),
    ).toBeNull();
  });

  it("reads the process's settings when given none", () => {
    vi.stubEnv('BETTER_AUTH_URL', HTTPS);
    vi.stubEnv('BETTER_AUTH_SECRET', SHORT);
    try {
      expect(authSettingsProblem()).toBe('auth_secret_short');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('the refusals', () => {
  it('name the setting and never a secret', () => {
    for (const text of Object.values(AUTH_SECRET_REFUSALS)) {
      expect(text).toContain('BETTER_AUTH_SECRET');
      expect(text).not.toContain(EXAMPLE_AUTH_SECRET);
    }
  });
});

// E00-T07a tester, finding 1: the auth library reads BETTER_AUTH_SECRETS itself and signs with its
// first entry in place of the BETTER_AUTH_SECRET it is given (better-auth 1.7.7,
// dist/context/create-context.mjs). Chairside sets no such list, so over https it is refused whatever
// it holds; over http nothing changes. The library itself: tests/integration/auth-secret.test.ts.
describe("BETTER_AUTH_SECRETS, the auth library's own list of secrets", () => {
  const KNOWN = '1:MARKER-short-known'; // a version and a short secret

  it('is refused over https whatever it holds: the library would sign with its first entry', () => {
    expect(authSecretRefusal(HTTPS, LONG_ENOUGH, KNOWN)).toBe('auth_secrets_set');
    expect(authSecretRefusal(HTTPS, LONG_ENOUGH, `1:${EXAMPLE_AUTH_SECRET}`)).toBe(
      'auth_secrets_set',
    );
    expect(authSecretRefusal(HTTPS, LONG_ENOUGH, `2:${'b'.repeat(44)},1:${LONG_ENOUGH}`)).toBe(
      'auth_secrets_set',
    );
  });

  it('is taken over https when it is empty, which the library reads as not set', () => {
    expect(authSecretRefusal(HTTPS, LONG_ENOUGH, '')).toBeNull();
    expect(authSecretRefusal(HTTPS, LONG_ENOUGH, undefined)).toBeNull();
  });

  it("leaves BETTER_AUTH_SECRET's refusals first, as before", () => {
    expect(authSecretRefusal(HTTPS, EXAMPLE_AUTH_SECRET, `1:${'b'.repeat(44)}`)).toBe(
      'auth_secret_example',
    );
    expect(authSecretRefusal(HTTPS, SHORT, KNOWN)).toBe('auth_secret_short');
  });

  it('changes nothing over http', () => {
    expect(authSecretRefusal(HTTP, LONG_ENOUGH, KNOWN)).toBeNull();
    expect(authSecretRefusal(HTTP, EXAMPLE_AUTH_SECRET, `1:${EXAMPLE_AUTH_SECRET}`)).toBeNull();
  });

  it("is read by authSettingsProblem, from the settings given or the process's", () => {
    expect(
      authSettingsProblem({
        BETTER_AUTH_URL: HTTPS,
        BETTER_AUTH_SECRET: LONG_ENOUGH,
        BETTER_AUTH_SECRETS: KNOWN,
      }),
    ).toBe('auth_secrets_set');
    vi.stubEnv('BETTER_AUTH_URL', HTTPS);
    vi.stubEnv('BETTER_AUTH_SECRET', LONG_ENOUGH);
    vi.stubEnv('BETTER_AUTH_SECRETS', KNOWN);
    try {
      expect(authSettingsProblem()).toBe('auth_secrets_set');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// E00-T07a tester, finding 2: a value pasted into a host's settings can carry a space or a line break
// around it, and the library signs with the value as given. So the secret is judged without them: the
// example with a newline is still the example, and 31 characters with a space are still 31.
describe('a secret with whitespace around it', () => {
  const AROUND = [
    { name: 'a space after it', wrap: (secret: string) => `${secret} ` },
    { name: 'a newline after it', wrap: (secret: string) => `${secret}\n` },
    { name: 'a Windows line end after it', wrap: (secret: string) => `${secret}\r\n` },
    { name: 'a tab before it', wrap: (secret: string) => `\t${secret}` },
    { name: 'spaces on both sides', wrap: (secret: string) => `  ${secret}  ` },
  ];

  it.each(AROUND)("is .env.example's over https, with $name", ({ wrap }) => {
    expect(authSecretRefusal(HTTPS, wrap(EXAMPLE_AUTH_SECRET))).toBe('auth_secret_example');
    expect(
      authSettingsProblem({
        BETTER_AUTH_URL: HTTPS,
        BETTER_AUTH_SECRET: wrap(EXAMPLE_AUTH_SECRET),
      }),
    ).toBe('auth_secret_example');
  });

  it.each(AROUND)(
    'is short over https when the secret has 31 characters, with $name',
    ({ wrap }) => {
      expect(authSecretRefusal(HTTPS, wrap(SHORT))).toBe('auth_secret_short');
    },
  );

  it('is taken over https when the secret itself is long enough, and over http as before', () => {
    expect(authSecretRefusal(HTTPS, ` ${LONG_ENOUGH}\n`)).toBeNull();
    expect(authSecretRefusal(HTTP, `${EXAMPLE_AUTH_SECRET}\n`)).toBeNull();
    expect(authSecretRefusal(HTTP, `${SHORT} `)).toBeNull();
  });
});

// E00-T07a critical review, required change 1: the auth library reads BETTER_AUTH_URL with the WHATWG
// URL parser and keeps the origin it makes, from which its cookies get Secure (better-auth 1.7.7,
// dist/utils/url.mjs and dist/context/create-context.mjs). That parser drops spaces and control
// characters before the URL and tabs and line breaks anywhere in it, and reads `https:/host`,
// `https:host` and `https:\host` as `https://host`: each is https to the library, so each meets every
// refusal. Over http, however it is written, nothing changes. The library itself:
// tests/integration/auth-secret.test.ts; the health check: tests/integration/health.test.ts.
describe('a BETTER_AUTH_URL the auth library reads as https, however it is written', () => {
  const FORMS = [
    { name: 'a space before it', url: ` ${HTTPS}` },
    { name: 'a line break before it', url: `\n${HTTPS}` },
    { name: 'one slash', url: 'https:/chairside.example.test' },
    { name: 'no slash', url: 'https:chairside.example.test' },
    { name: 'a backslash', url: 'https:\\chairside.example.test' },
    { name: 'a tab inside the scheme', url: 'ht\ttps://chairside.example.test' },
  ];
  const LIST = '1:MARKER-short-known'; // BETTER_AUTH_SECRETS: a version and a short secret

  it.each(FORMS)('is https to the parser the library reads it with: $name', ({ url }) => {
    expect(new URL(url).origin).toBe(HTTPS);
  });

  it.each(FORMS)(
    'refuses the example secret, a short one and BETTER_AUTH_SECRETS: $name',
    ({ url }) => {
      expect(authSecretRefusal(url, EXAMPLE_AUTH_SECRET)).toBe('auth_secret_example');
      expect(authSecretRefusal(url, SHORT)).toBe('auth_secret_short');
      expect(authSecretRefusal(url, LONG_ENOUGH, LIST)).toBe('auth_secrets_set');
    },
  );

  it.each(FORMS)('is read so by authSettingsProblem too: $name', ({ url }) => {
    const settings = (secret: string, secrets?: string) =>
      authSettingsProblem({
        BETTER_AUTH_URL: url,
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_SECRETS: secrets,
      });
    expect(settings(EXAMPLE_AUTH_SECRET)).toBe('auth_secret_example');
    expect(settings(SHORT)).toBe('auth_secret_short');
    expect(settings(LONG_ENOUGH, LIST)).toBe('auth_secrets_set');
  });

  it.each(FORMS)('takes a secret of 32 characters that is not the example: $name', ({ url }) => {
    expect(authSecretRefusal(url, LONG_ENOUGH)).toBeNull();
  });

  it('still refuses a URL written https:// that the parser cannot read, as before', () => {
    // The library does not start with such a URL either; the check refused it before and still does.
    for (const url of ['https://', 'HTTPS://', 'https://chairside example.test']) {
      expect(authSecretRefusal(url, EXAMPLE_AUTH_SECRET), url).toBe('auth_secret_example');
      expect(authSecretRefusal(url, SHORT), url).toBe('auth_secret_short');
      expect(authSecretRefusal(url, LONG_ENOUGH, LIST), url).toBe('auth_secrets_set');
    }
  });

  it('changes nothing over http, however it is written', () => {
    const forms = [
      ` ${HTTP}`,
      `\n${HTTP}`,
      'http:/localhost:3000',
      'http:localhost:3000',
      'http:\\localhost:3000',
      'HTTP://localhost:3000',
      'ht\ttp://localhost:3000',
    ];
    for (const url of forms) {
      expect(new URL(url).origin, JSON.stringify(url)).toBe(HTTP);
      expect(authSecretRefusal(url, EXAMPLE_AUTH_SECRET), JSON.stringify(url)).toBeNull();
      expect(authSecretRefusal(url, SHORT), JSON.stringify(url)).toBeNull();
      expect(authSecretRefusal(url, LONG_ENOUGH, LIST), JSON.stringify(url)).toBeNull();
    }
  });
});

// E00-T07a tester, after fix round 3: the check reads BETTER_AUTH_URL as the auth library itself does,
// asked of the library (an in-memory instance), not of a parser standing in for it. Each form below is
// built from what a value pasted into a host's settings can carry around and inside its scheme: where
// the library's origin is https, or its session cookie Secure, every refusal is met; where it is http,
// none; a form the library cannot start with makes no session either way. A better-auth upgrade that
// reads the URL another way turns this red.
describe('BETTER_AUTH_URL, as the auth library itself reads it', () => {
  async function libraryReads(url: string): Promise<'https' | 'http' | 'no start'> {
    try {
      const auth = betterAuth({
        baseURL: url,
        secret: LONG_ENOUGH,
        database: memoryAdapter({}),
        telemetry: { enabled: false },
        logger: { disabled: true },
      });
      const context = await auth.$context;
      const cookie = context.authCookies.sessionToken;
      const https =
        String(context.options.baseURL).startsWith('https://') ||
        cookie.attributes.secure === true ||
        cookie.name.startsWith('__Secure-');
      return https ? 'https' : 'http';
    } catch {
      return 'no start';
    }
  }

  it('meets every refusal where the library reads https, and none where it reads http', async () => {
    const forms: string[] = [];
    const noBreakSpace = String.fromCharCode(0xa0);
    const byteOrderMark = String.fromCharCode(0xfeff);
    for (const before of ['', ' ', '\n', '\r\n', '\t', noBreakSpace, byteOrderMark])
      for (const scheme of ['https', 'HTTPS', 'ht\ttps', 'http', 'HTTP', 'blob:https', 'wss'])
        for (const separator of ['://', ':/', ':', ':\\', ':///'])
          for (const after of ['', '/', '/api/auth', ' ', '\n'])
            forms.push(`${before}${scheme}${separator}chairside.example.test${after}`);
    const readings = await Promise.all(forms.map(libraryReads));

    const wrong: string[] = [];
    readings.forEach((library, i) => {
      const url = forms[i] ?? '';
      const refusals = [
        authSecretRefusal(url, EXAMPLE_AUTH_SECRET),
        authSecretRefusal(url, SHORT),
        authSecretRefusal(url, LONG_ENOUGH, `1:${SHORT}`),
      ];
      if (library === 'https' && refusals.some((refusal) => refusal === null)) {
        wrong.push(`https to the library, taken: ${JSON.stringify(url)}`);
      }
      if (library === 'http' && refusals.some((refusal) => refusal !== null)) {
        wrong.push(`http to the library, refused: ${JSON.stringify(url)}`);
      }
    });
    expect(wrong).toEqual([]);

    // Not true by default: the library read forms each way, as the review's forms show.
    expect(await libraryReads(` ${HTTPS}`)).toBe('https');
    expect(await libraryReads('https:\\chairside.example.test')).toBe('https');
    expect(await libraryReads(HTTP)).toBe('http');
    for (const kind of ['https', 'http', 'no start'] as const) {
      expect(readings.filter((library) => library === kind).length, kind).toBeGreaterThan(100);
    }
  });
});
