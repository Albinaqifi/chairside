import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { CLINIC_COOKIE } from '@/lib/cookies';
import { clinicsForUser, getAuth, resolveClinic, type ClinicChoice } from '@/modules/auth';

/**
 * Who is making this request, and for which clinic. Every staff page, layout and server action
 * starts from here; the action wrapper (E00-T03) builds on it. The results are memoised for one
 * request, so a layout and its page share one database lookup.
 */

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
}

/**
 * The signed-in user, from the session cookie, or null. Reads the session without moving its end
 * forward: a page cannot renew the browser's cookie, so only the request proxy (src/proxy.ts) moves
 * the session, together with the cookie (D-067).
 */
export const currentUser = cache(async (): Promise<SignedInUser | null> => {
  const result = await getAuth().api.getSession({
    headers: await headers(),
    query: { disableRefresh: true },
  });
  if (!result) return null;
  return { id: result.user.id, name: result.user.name, email: result.user.email };
});

/** The signed-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SignedInUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export interface Staff {
  user: SignedInUser;
  /** The clinic the user acts for: their active membership there, with role and extras. */
  clinic: ClinicChoice;
  /** How many clinics the user may enter (more than one: show "switch clinic"). */
  clinicCount: number;
}

/**
 * The signed-in user and the clinic they act for, or a redirect: to the login page without a
 * session, to the clinic picker when the clinic is not settled. Only a clinic the user has an
 * active membership in can come out of here (resolveClinic), whatever the cookie says.
 */
export const currentStaff = cache(async (): Promise<Staff> => {
  const user = await requireUser();
  const choices = await clinicsForUser(user.id);
  const picked = (await cookies()).get(CLINIC_COOKIE)?.value;
  const resolved = resolveClinic(choices, picked);
  if (resolved.kind !== 'clinic') redirect('/choose-clinic');
  return { user, clinic: resolved.choice, clinicCount: choices.length };
});
