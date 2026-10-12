/**
 * The clinic itself, the tenant (data-model.md section 1). Public API of the tenancy module.
 */
export { clinicPlace, type ClinicPlace } from './clinic-place';
export { closedDaysBetween, openingHours, type ClosedDay, type OpeningHours } from './hours';
export {
  CLINIC_LOCALES,
  createClinic,
  newClinicProblems,
  type NewClinic,
  type NewClinicField,
} from './create-clinic';
