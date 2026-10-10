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
  // The request's headers before the auth library: while `next build` tries to prerender a page,
  // reading them ends that try (the page is rendered for each request), so the library is never made
  // there and the image is built without any setting (E00-T07a).
  const requestHeaders = await headers();
  const result = await getAuth().api.getSession({
    headers: requestHeaders,
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

type StaffResolution =
  { kind: 'staff'; staff: Staff } | { kind: 'signed_out' } | { kind: 'no_clinic' };

/**
 * Who this request is for: a member in a settled clinic, or why not. Only a clinic the user has an
 * active membership in can come out of here (resolveClinic), whatever the cookie says.
 */
const resolveStaff = cache(async (): Promise<StaffResolution> => {
  const user = await currentUser();
  if (!user) return { kind: 'signed_out' };
  const choices = await clinicsForUser(user.id);
  const picked = (await cookies()).get(CLINIC_COOKIE)?.value;
  const resolved = resolveClinic(choices, picked);
  if (resolved.kind !== 'clinic') return { kind: 'no_clinic' };
  return { kind: 'staff', staff: { user, clinic: resolved.choice, clinicCount: choices.length } };
});

/**
 * The signed-in user and the clinic they act for, or a redirect: to the login page without a
 * session, to the clinic picker when the clinic is not settled.
 */
export const currentStaff = cache(async (): Promise<Staff> => {
  const resolution = await resolveStaff();
  if (resolution.kind === 'signed_out') redirect('/login');
  if (resolution.kind === 'no_clinic') redirect('/choose-clinic');
  return resolution.staff;
});

/**
 * What currentStaff() gives, without its redirects: null without a session or a settled clinic.
 * For what runs for every page, the login page and the clinic picker too, and must send no one
 * anywhere: the clinic's time zone (src/i18n/request.ts). Never a check of who may do something.
 */
export async function settledStaff(): Promise<Staff | null> {
  const resolution = await resolveStaff();
  return resolution.kind === 'staff' ? resolution.staff : null;
}
