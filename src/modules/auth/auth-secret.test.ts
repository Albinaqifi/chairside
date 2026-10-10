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
