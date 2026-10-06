import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptSignIn } from './login-form';

// E00-T04c, acceptance 4 (the login form's part, below the browser): a sign-in whose call fails at
// the network is `failed`, so the form shows login.errors.failed and its button works again; the
// tester checks the form itself in a browser. The auth library's client is a stand-in that answers
// as each test says. Every value is synthetic.

const client = vi.hoisted(() => ({ signInEmail: vi.fn() }));
vi.mock('@/app/_lib/auth-client', () => ({
  authClient: { signIn: { email: client.signInEmail } },
}));

const EMAIL = 'front-desk-test@example.test';
const PASSWORD = 'MARKER-pw-0e4f';

beforeEach(() => {
  client.signInEmail.mockReset();
});

describe('attemptSignIn', () => {
  it('signed in: no failure', async () => {
    client.signInEmail.mockResolvedValue({ data: {}, error: null });
    expect(await attemptSignIn(EMAIL, PASSWORD)).toBeNull();
    expect(client.signInEmail).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
  });

  it.each([
    { status: 401, failure: 'wrongCredentials' },
    { status: 429, failure: 'tooManyAttempts' },
    { status: 500, failure: 'failed' },
  ])('refused with status $status: $failure, as before', async ({ status, failure }) => {
    client.signInEmail.mockResolvedValue({ data: null, error: { status } });
    expect(await attemptSignIn(EMAIL, PASSWORD)).toBe(failure);
  });

  it('a call that fails at the network (the promise rejects): failed', async () => {
    client.signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await attemptSignIn(EMAIL, PASSWORD)).toBe('failed');
  });
});
