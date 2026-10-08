import { unstable_rethrow } from 'next/navigation';
import type { StaffAction } from '@/app/_lib/actions';
import type { PatientList } from '@/modules/patients';

/*
 * What the patient list shows after a search (E01-T02a): the read's answer, or a call that failed
 * at the network, turned into one of the list's answers. No React here, so each answer is
 * unit-tested; ./patient-list.tsx shows them.
 */

/** The longest search the list takes, in characters: the search box's limit and the read's. */
export const SEARCH_MAX_LENGTH = 100;

export type SearchAnswer =
  /** The patients that match. */
  | { kind: 'found'; list: PatientList }
  /** Another tab switched clinic (D-069): nothing was read, and the page should be reloaded. */
  | { kind: 'clinic_changed' }
  /** `internal`, or the call never got an answer (the network, the server restarting). */
  | { kind: 'failed' };

/**
 * Sends what was typed to the patients' read with the clinic id given, the frame's (D-092), never
 * one a page passes, and gives the list's answer. Next.js's redirect (an ended session: the login
 * page) is Next.js's to carry out, as for a staff form (src/app/_lib/form-answer.ts, D-074).
 */
export async function sendSearch(
  read: StaffAction<{ text: string }, PatientList>,
  clinicId: string,
  text: string,
): Promise<SearchAnswer> {
  try {
    const result = await read(clinicId, { text });
    if (result.ok) return { kind: 'found', list: result.value };
    return result.error.code === 'clinic_changed' ? { kind: 'clinic_changed' } : { kind: 'failed' };
  } catch (error) {
    unstable_rethrow(error);
    return { kind: 'failed' };
  }
}
