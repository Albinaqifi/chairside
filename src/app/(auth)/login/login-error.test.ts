import { describe, expect, it } from 'vitest';
import messages from '@/i18n/en.json';
import { loginError } from './login-form';

describe('loginError: the text a failed sign-in shows', () => {
  it.each([
    { status: 401, key: 'wrongCredentials' },
    { status: 429, key: 'tooManyAttempts' },
    { status: 500, key: 'failed' },
    { status: 0, key: 'failed' },
    { status: undefined, key: 'failed' },
  ])('status $status → login.errors.$key', ({ status, key }) => {
    expect(loginError(status)).toBe(key);
  });

  it('has a text in the message file for every answer', () => {
    for (const status of [401, 429, 500]) {
      expect(messages.login.errors[loginError(status)]).not.toBe('');
    }
  });
});
