import type { ExtraPermission, ProviderKind, Role } from './permissions';

/** A clinic a user may enter: one of their active memberships, as clinics_for_user() returns it. */
export interface ClinicChoice {
  membershipId: string;
  clinicId: string;
  clinicName: string;
  role: Role;
  extraPermissions: ExtraPermission[];
  /**
   * The kind of the provider this membership is linked to (the person's calendar column, in this
   * clinic), or null when it is linked to none (D-091). can() reads it.
   */
  providerKind: ProviderKind | null;
}

/**
 * Which clinic a signed-in user acts for:
 * - `clinic`: the one they picked, or their only one;
 * - `choose`: they belong to several and have not picked a valid one yet (clinic picker);
 * - `none`: they have no active membership anywhere.
 */
export type ClinicResolution =
  | { kind: 'clinic'; choice: ClinicChoice }
  | { kind: 'choose'; choices: readonly ClinicChoice[] }
  | { kind: 'none' };

/**
 * Resolves the current clinic from the user's active memberships and the clinic id they picked
 * earlier (a cookie, so never trusted on its own: it counts only if it is one of the choices).
 * Pure.
 */
export function resolveClinic(
  choices: readonly ClinicChoice[],
  pickedClinicId: string | undefined,
): ClinicResolution {
  const picked = choices.find((choice) => choice.clinicId === pickedClinicId);
  if (picked) return { kind: 'clinic', choice: picked };
  if (choices.length === 0) return { kind: 'none' };
  if (choices.length === 1) return { kind: 'clinic', choice: choices[0]! };
  return { kind: 'choose', choices };
}
