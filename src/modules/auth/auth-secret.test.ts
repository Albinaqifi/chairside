import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
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
