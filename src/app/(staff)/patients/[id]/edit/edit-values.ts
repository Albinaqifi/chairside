import type { PatientProfile } from '@/modules/patients';
import type { PatientValues } from '../../new/patient-form-fields';

/**
 * What the edit form starts with, from the patient's profile read: the phone as the clinic writes it
 * (D-097), which `patients.update` reads back to the stored number, so a form saved untouched is
 * `nothing_changed`. A value the patient has none of is '' (a form sends that for none).
 */
export function editValuesOf(profile: PatientProfile): PatientValues {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth ?? '',
    language: profile.language,
    phone: profile.phone ?? '',
    email: profile.email ?? '',
    guardianName: profile.guardianName ?? '',
    notes: profile.notes,
  };
}
