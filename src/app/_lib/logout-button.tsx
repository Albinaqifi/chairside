'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { useToast } from '@/ui/toast';
import { authClient } from './auth-client';

/**
 * Ends the session through the auth library; false when it did not: the library answered with an
 * error, or the call failed at the network (the promise rejects) (E00-T04c).
 */
export async function attemptSignOut(): Promise<boolean> {
  try {
    const { error } = await authClient.signOut();
    return !error;
  } catch {
    return false;
  }
}

/**
 * Ends the session (the auth library deletes it and clears the cookie), then shows the login page.
 * When that fails, a toast says so and the button works again, in the sidebar and in the clinic
 * picker alike (the root layout's toast). A className restyles the quiet button where it stands,
 * as the sidebar's last item for one.
 */
export function LogoutButton({ className }: { className?: string }) {
  const t = useTranslations('logout');
  const router = useRouter();
  const showToast = useToast();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    if (await attemptSignOut()) {
      router.push('/login');
      router.refresh();
      return;
    }
    showToast(t('failed'), 'failed');
    setPending(false);
  }

  return (
    <Button
      type="button"
      variant="quiet"
      className={className}
      onClick={() => void logout()}
      disabled={pending}
    >
      {t('button')}
    </Button>
  );
}
