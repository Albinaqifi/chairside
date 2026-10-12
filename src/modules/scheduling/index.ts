/**
 * Appointments, providers, treatment types and breaks (data-model.md section 2). Public API of the
 * scheduling module: other modules read its tables only through these functions (module rule 1).
 * The calendar's day (E01-T04a): the providers, their breaks on a weekday, the appointments of a day.
 */
export {
  APPOINTMENT_STATUSES,
  appointmentsOnDay,
  type AppointmentStatus,
  type DayAppointment,
} from './appointments';
export { breaksOnWeekday, listProviders, type Provider, type ProviderBreak } from './providers';
export { lastAndNextVisits, type PatientVisits } from './visits';
