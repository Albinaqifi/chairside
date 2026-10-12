/**
 * A clinic's patients (data-model.md section 2). Public API of the patients module: list and search
 * them (E01-T02a), add one and find who they may already be (E01-T02b), as
 * `import * as patients from '@/modules/patients'`, then `patients.create(tx, patient, now)`; their
 * names by id, for the calendar's day (E01-T04a).
 */
export { create, type CreateRefusal, type CreateResult, type NewPatient } from './create';
export {
  DUPLICATES_LIMIT,
  likelyDuplicates,
  type LikelyDuplicate,
  type TypedPatient,
} from './duplicates';
export {
  LIST_LIMIT,
  listPatients,
  PATIENT_STATUSES,
  type PatientList,
  type PatientRow,
  type PatientStatus,
} from './list';
export { patientNames, type PatientName } from './names';
// E01-T08a: the clinic's own phone on Settings is read and shown as a patient's is (D-097). Here, as
// `patients` imports `tenancy`, which so cannot import them back.
export { phoneAsWritten, readPhone } from './phone';
export { phoneWithCountryCode } from './phone'; // E01-T08b: the clinic's phone on Settings (D-111)
