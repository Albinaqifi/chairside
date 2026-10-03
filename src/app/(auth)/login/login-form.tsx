'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authClient } from '@/app/_lib/auth-client';

// Plain styling until the design system exists (E00-T04).

/**
 * What the person reads when a sign-in attempt fails. The text for a refused login is the same
 * whether the email exists or not.
 */
export function loginErrorMessage(status: number | undefined): string {
  if (status === 401) return 'Wrong email or password.';
  if (status === 429) return 'Too many attempts. Wait a minute, then try again.';
  return 'Login did not work. Try again.';
}

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    });
    if (failure) {
      setError(loginErrorMessage(failure.status));
      setPending(false);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void submit(event)} style={{ display: 'grid', gap: '0.75rem' }}>
      <label>
        Email
        <br />
        <input name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        Password
        <br />
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
