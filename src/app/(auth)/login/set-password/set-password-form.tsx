'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { authClient } from '@/app/_lib/auth-client';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

/** Why the password was not set: the key of its text under setPassword.errors in the message file. */
export type SetPasswordFailure =
  'invalidLink' | 'tooShort' | 'tooLong' | 'tooManyAttempts' | 'failed';

/** How long a password may be: the auth module's PASSWORD_LENGTH, which the page passes. */
export interface PasswordLength {
  min: number;
  max: number;
}

/**
 * The text for the auth library's answer from /reset-password. A token that is wrong, used or
 * expired is one answer there, INVALID_TOKEN, and one text here: the page never says which.
 */
export function setPasswordFailure(error: { status?: number; code?: string }): SetPasswordFailure {
  if (error.status === 429) return 'tooManyAttempts';
  switch (error.code) {
    case 'INVALID_TOKEN':
    case 'USER_NOT_FOUND': // the person of a token is never deleted; answered as the token would be
      return 'invalidLink';
    case 'PASSWORD_TOO_SHORT':
      return 'tooShort';
    case 'PASSWORD_TOO_LONG':
      return 'tooLong';
    default:
      return 'failed';
  }
}

/**
 * The token of the link the page was opened with: what follows `#` in the address, which the
 * browser never sends to the server (D-101); '' when there is none.
 */
export function tokenOf(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * Sets the password through the auth library's /reset-password (D-101), which checks the token and
 * the length again, sets the password, spends the token and ends the person's sessions. Gives why it
 * failed, or null when it did not. The length is checked first, then whether there is a token at
 * all, so the person reads the same answer for a link without a token as for a wrong, used or
 * expired one, and nothing is sent for either check. A call that fails at the network is `failed`.
 */
export async function attemptSetPassword(
  token: string,
  newPassword: string,
  length: PasswordLength,
): Promise<SetPasswordFailure | null> {
  if (newPassword.length < length.min) return 'tooShort';
  if (newPassword.length > length.max) return 'tooLong';
  if (token === '') return 'invalidLink';
  try {
    const { error } = await authClient.resetPassword({ newPassword, token });
    return error ? setPasswordFailure(error) : null;
  } catch {
    return 'failed';
  }
}

/** Whether the form runs in the browser never changes once it does: nothing to subscribe to. */
function subscribeToNothing() {
  return () => undefined;
}

/**
 * The form of the page a setup link opens (E00-T05b): one new password, sent with the link's token
 * to the auth library. Like the login form (D-076), it never puts the password in the URL:
 * - It posts to its own page's URL. With its script running, onSubmit stops the browser's own
 *   submission; sent any other way, the field goes in the request body, and Next.js answers with the
 *   page without reading it. The token is never a field: it stays after `#` until the script sends it.
 * - The button is disabled in the server's HTML and enabled once the form runs in the browser, so
 *   nothing is sent before the script has run, or at all without JavaScript.
 * Once the password is set, the form gives way to a line that says so, which takes the focus, and a
 * link to the login page.
 */
export function SetPasswordForm({
  length,
  linkDays,
}: {
  length: PasswordLength;
  /** How long a link works (the auth module's SETUP_LINK_DAYS), for the text of one that does not. */
  linkDays: number;
}) {
  const t = useTranslations('setPassword');
  // false in the server's HTML and while the page hydrates, true once the form runs in the browser.
  const inBrowser = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [failure, setFailure] = useState<SetPasswordFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setFailure(null);
    const result = await attemptSetPassword(
      tokenOf(window.location.hash),
      String(form.get('password') ?? ''),
      length,
    );
    setPending(false);
    if (result) {
      setFailure(result);
      return;
    }
    setDone(true);
  }

  if (done) return <PasswordSet />;

  return (
    <form
      method="post"
      action="/login/set-password"
      onSubmit={(event) => void submit(event)}
      className="mt-6 grid gap-4"
    >
      <noscript className="block rounded-control border border-warn-border bg-warn-bg px-3 py-2">
        {t('noscript')}
      </noscript>
      <div className="grid gap-2">
        <Label htmlFor="set-password-new">{t('password')}</Label>
        <Input
          id="set-password-new"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby="set-password-hint"
        />
        <p id="set-password-hint" className="text-small text-muted">
          {t('hint', { min: length.min })}
        </p>
      </div>
      {failure && (
        <p role="alert" className="rounded-control bg-error-bg px-3 py-2 text-error">
          {t(`errors.${failure}`, { min: length.min, max: length.max, days: linkDays })}
        </p>
      )}
      <Button type="submit" disabled={!inBrowser || pending} className="mt-1 w-full">
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}

/** The password is set: a line that says so, focused so a screen reader reads it, and the way on. */
function PasswordSet() {
  const t = useTranslations('setPassword');
  const said = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    said.current?.focus();
  }, []);
  return (
    <div className="mt-6 grid gap-4">
      {/* The focus ring of the buttons (src/ui/button.tsx), not the browser's own. */}
      <p
        ref={said}
        role="status"
        tabIndex={-1}
        className="rounded-control bg-primary-soft px-3 py-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
      >
        {t('done')}
      </p>
      <Button asChild className="w-full">
        <Link href="/login">{t('logIn')}</Link>
      </Button>
    </div>
  );
}
