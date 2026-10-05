'use client';

import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
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

/** Whether the form runs in the browser never changes once it does: nothing to subscribe to. */
function subscribeToNothing() {
  return () => undefined;
}

/**
 * Signs in through the auth library (D-063), and never puts the email and password in the URL
 * (D-076):
 * - The form posts to /login. With its script running, onSubmit stops the browser's own submission.
 *   Sent any other way (a script calling form.submit()), the fields go in the request body, and
 *   Next.js answers with the login page without reading them.
 * - The button is disabled in the server's HTML and enabled once the form runs in the browser, so
 *   nothing is sent before the script has run, or at all without JavaScript: a disabled button
 *   stops Enter from submitting the form too.
 */
export function LoginForm() {
  const router = useRouter();
  // false in the server's HTML and while the page hydrates, true once the form runs in the browser.
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
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
    <form
      method="post"
      action="/login"
      onSubmit={(event) => void submit(event)}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <noscript>
        JavaScript is needed to log in. Turn it on in your browser, then reload the page.
      </noscript>
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
      <button type="submit" disabled={!inBrowser || pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
