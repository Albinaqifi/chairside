'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { authClient } from '@/app/_lib/auth-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

/** Why a sign-in attempt failed: the key of its text under login.errors in the message file. */
export type LoginError = 'wrongCredentials' | 'tooManyAttempts' | 'failed';

/**
 * What the person reads when a sign-in attempt fails. The text for a refused login is the same
 * whether the email exists or not.
 */
export function loginError(status: number | undefined): LoginError {
  if (status === 401) return 'wrongCredentials';
  if (status === 429) return 'tooManyAttempts';
  return 'failed';
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
  const t = useTranslations('login');
  const router = useRouter();
  // false in the server's HTML and while the page hydrates, true once the form runs in the browser.
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [error, setError] = useState<LoginError | null>(null);
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
      setError(loginError(failure.status));
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
      className="mt-6 grid gap-4"
    >
      <noscript className="block rounded-control border border-warn-border bg-warn-bg px-3 py-2">
        {t('noscript')}
      </noscript>
      <div className="grid gap-2">
        <Label htmlFor="login-email">{t('email')}</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="login-password">{t('password')}</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <p role="alert" className="rounded-control bg-error-bg px-3 py-2 text-error">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button type="submit" disabled={!inBrowser || pending} className="mt-1 w-full">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
