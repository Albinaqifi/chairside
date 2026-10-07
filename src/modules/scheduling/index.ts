/**
 * Appointments, providers, treatment types and breaks (data-model.md section 2). Public API of the
 * scheduling module: other modules read its tables only through these functions (module rule 1).
 */
export { lastAndNextVisits, type PatientVisits } from './visits';
