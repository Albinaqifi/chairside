import { unstable_rethrow } from 'next/navigation';
import type { StaffAction } from '@/app/_lib/actions';
import type { LikelyDuplicate } from '@/modules/patients';

/*
 * The new-patient form's check for a patient already in the list (E01-T02b): what it reads of the
 * form, and the patients its answer names. No React here, so each is unit-tested;
 * ./new-patient-form.tsx shows the warning.
 */

/** The fields a likely duplicate is found by, as typed: '' for one left empty. */
export interface TypedFields {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
}

/** The fields the check reads, from the form's data. */
export function typedOf(sent: FormData): TypedFields {
  const text = (name: keyof TypedFields): string => {
    const value = sent.get(name);
    return typeof value === 'string' ? value : '';
  };
  return {
    firstName: text('firstName'),
    lastName: text('lastName'),
    dateOfBirth: text('dateOfBirth'),
    phone: text('phone'),
    email: text('email'),
  };
}

/**
 * Sends what is typed to the check with the clinic id given, the frame's (D-092), as the action's
 * input, in the request's body (D-095), and gives the patients the warning names. A check that
 * gives no answer (another tab's clinic, the general failure, a call that never got one) names
 * none: the warning only helps, and the button still saves. Next.js's redirect after an ended
 * session is Next.js's to carry out, as for a staff form (src/app/_lib/form-answer.ts, D-074).
 */
export async function sendCheck(
  read: StaffAction<TypedFields, LikelyDuplicate[]>,
  clinicId: string,
  typed: TypedFields,
): Promise<readonly LikelyDuplicate[]> {
  try {
    const result = await read(clinicId, typed);
    return result.ok ? result.value : [];
  } catch (error) {
    unstable_rethrow(error);
    return [];
  }
}
