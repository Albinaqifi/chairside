'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from './auth-client';

/** Ends the session (the auth library deletes it and clears the cookie), then shows the login page. */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" onClick={() => void logout()} disabled={pending}>
      Log out
    </button>
  );
}
