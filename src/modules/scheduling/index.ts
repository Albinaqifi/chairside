/**
 * Appointments, providers, treatment types and breaks (data-model.md section 2). Public API of the
 * scheduling module: other modules read its tables only through these functions (module rule 1).
 * The calendar's day (E01-T04a): the providers, their breaks on a weekday, the appointments of a day.
 * Booking (E01-T05a): an appointment booked, and the treatment types a booking can take.
 * Settings: the treatment types (E01-T09a) and the providers (E01-T09b, E01-T09d, E01-T09c, E01-T09e).
 */
export {
  APPOINTMENT_STATUSES,
  appointmentsOnDay,
  type AppointmentStatus,
  type DayAppointment,
} from './appointments';
export {
  createAppointment,
  type BookingRefusal,
  type BookingResult,
  type NewBooking,
} from './booking';
// E01-T06a: the appointment state machine, the only writer of an appointment's status.
export { appointmentChanged, type AppointmentChanged, type AppointmentChangedHook } from './events';
export {
  nextAppointmentStatus,
  STATUS_ACTIONS,
  type NextStatus,
  type StatusAction,
  type StatusActor,
  type StatusFacts,
  type StatusRefusal,
} from './status-machine';
export {
  CANCEL_REASON_MAX,
  changeAppointmentStatus,
  type StatusChange,
  type StatusChangeRefusal,
  type StatusChangeResult,
} from './status-change';
export { breaksOnWeekday, listProviders, type Provider, type ProviderBreak } from './providers';
// E01-T09b, E01-T09d, E01-T09c, E01-T09e: the providers as Settings keeps them.
export {
  addProvider,
  addProviderBreak,
  changeProvider,
  clinicBreaks,
  clinicProviders,
  moveProvider,
  PROVIDER_BREAK_LABEL_MAX,
  PROVIDER_CHAIR_MAX,
  PROVIDER_DIRECTIONS,
  PROVIDER_HUE_MAX,
  PROVIDER_KINDS,
  PROVIDER_NAME_MAX,
  PROVIDER_SHORT_NAME_MAX,
  removeProviderBreak,
  setProviderActive,
  visitsAhead,
  type AddProviderBreakResult,
  type ChangeProviderResult,
  type ClinicBreak,
  type ClinicProvider,
  type MoveProviderRefusal,
  type MoveProviderResult,
  type NewProviderBreak,
  type ProviderDirection,
  type ProviderFields,
  type ProviderKind,
  type SetProviderActiveRefusal,
  type SetProviderActiveResult,
} from './providers';
export { activeTreatmentTypes, type TreatmentType } from './treatment-types';
// E01-T09a: the catalogue as Settings keeps it.
export {
  addTreatmentType,
  changeTreatmentType,
  clinicTreatmentTypes,
  setTreatmentTypeActive,
  TREATMENT_PRICE_MAX,
  TREATMENT_TYPE_NAME_MAX,
  type AddTreatmentTypeResult,
  type CatalogueType,
  type ChangeTreatmentTypeResult,
  type SetTreatmentTypeActiveRefusal,
  type SetTreatmentTypeActiveResult,
  type TreatmentTypeFields,
} from './treatment-types';
// E01-T03a: patientVisits, the profile's next visit and history; E01-T03b: patientVisitsAhead.
export {
  HISTORY_LIMIT,
  lastAndNextVisits,
  patientVisits,
  patientVisitsAhead,
  type PatientVisit,
  type PatientVisits,
  type PatientVisitsOf,
  VISITS_AHEAD_LIMIT,
  type VisitAhead,
} from './visits';
