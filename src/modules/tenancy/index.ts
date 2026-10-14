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
// E01-T08a: the Settings page's details, the values its checks take, and the zone both PostgreSQL
// and Intl know by its name (D-110), for Settings and `pnpm clinic:create`.
export {
  CLINIC_DETAIL_FIELDS,
  clinicDetails,
  saveClinicDetails,
  type ClinicDetailField,
  type ClinicDetails,
  type SaveDetailsRefusal,
  type SaveDetailsResult,
} from './clinic-details';
export { clinicCountries, clinicCurrencies } from './create-clinic';
export { clinicTimeZones, isClinicTimeZoneName, knownTimeZone } from './time-zone';
// E01-T08b: the week's opening hours, saved from Settings.
export { saveOpeningHours, type SaveHoursResult } from './hours';
// E01-T08c: the closed days from the clinic's today on, added and removed from Settings.
export {
  addClosedDay,
  CLOSED_DAY_LABEL_MAX,
  closedDaysAhead,
  removeClosedDay,
  type AddClosedDayRefusal,
  type AddClosedDayResult,
  type RemoveClosedDayRefusal,
  type RemoveClosedDayResult,
} from './closed-days';
