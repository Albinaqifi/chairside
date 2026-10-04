'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { userAction } from '@/app/_lib/actions';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { clinicsForUser, cookiesAreSecure } from '@/modules/auth';

/**
 * Remembers which clinic the user works in. A clinic id that is not a UUID is refused before any
 * lookup. Only a clinic they have an active membership in is accepted, and the cookie is checked
 * against the memberships again on every request (currentStaff), so it never grants anything by
 * itself. Works as a plain form post too, without JavaScript.
 */
export const chooseClinic = userAction(
  { input: z.object({ clinicId: z.uuid() }) },
  async ({ input, user }) => {
    const choice = (await clinicsForUser(user.id)).find((c) => c.clinicId === input.clinicId);
    if (!choice) redirect('/choose-clinic');
    (await cookies()).set(CLINIC_COOKIE, choice.clinicId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookiesAreSecure(),
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    redirect('/');
  },
);
