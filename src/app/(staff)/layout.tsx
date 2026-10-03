import Link from 'next/link';
import type { ReactNode } from 'react';
import { currentStaff } from '@/app/_lib/auth';
import { LogoutButton } from '@/app/_lib/logout-button';
import { ROLE_LABELS } from '@/modules/auth';

/**
 * Everything under (staff) needs a signed-in user with a clinic. A layout does not re-render on
 * navigation (Next.js, "Layouts and auth checks"), so every page and action under it calls
 * currentStaff() too; it is memoised per request, so this costs nothing extra.
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  return (
    <>
      <header
        style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 1rem' }}
      >
        <strong>Chairside</strong>
        <span>{staff.clinic.clinicName}</span>
        <span style={{ marginLeft: 'auto' }}>
          {staff.user.name} · {ROLE_LABELS[staff.clinic.role]}
        </span>
        {staff.clinicCount > 1 && <Link href="/choose-clinic">Switch clinic</Link>}
        <LogoutButton />
      </header>
      <main style={{ padding: '0 1rem' }}>{children}</main>
    </>
  );
}
