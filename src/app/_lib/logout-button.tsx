'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/ui/button';
import { authClient } from './auth-client';

/**
 * Ends the session (the auth library deletes it and clears the cookie), then shows the login page.
 * A className restyles the quiet button where it stands, as the sidebar's last item for one.
 */
export function LogoutButton({ className }: { className?: string }) {
  const t = useTranslations('logout');
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await authClient.signOut();
    router.push('/login');
    router.refresh();
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
