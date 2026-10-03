'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireUser } from '@/app/_lib/auth';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { clinicsForUser, cookiesAreSecure } from '@/modules/auth';

/**
 * Remembers which clinic the user works in. Only a clinic they have an active membership in is
 * accepted here, and the cookie is checked against the memberships again on every request
 * (currentStaff), so it never grants anything by itself.
 */
export async function chooseClinic(formData: FormData): Promise<void> {
  const user = await requireUser();
  const clinicId = formData.get('clinicId');
  const choice = (await clinicsForUser(user.id)).find((c) => c.clinicId === clinicId);
  if (!choice) redirect('/choose-clinic');
  (await cookies()).set(CLINIC_COOKIE, choice.clinicId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookiesAreSecure(),
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/');
}
