import type { TenantTransaction } from '@/db/tenant';
import { dayInZone, isoWeekday, type CalendarDay } from '@/lib/calendar-day';
import { activeMembership } from '@/modules/auth';
import { patientNames } from '@/modules/patients';
import { appointmentsOnDay, breaksOnWeekday, listProviders } from '@/modules/scheduling';
import { clinicPlace, closedDaysBetween, openingHours } from '@/modules/tenancy';
import { layoutDay, type CalendarDayView } from './day';

/**
 * The calendar's day (E01-T04a): the day asked for, or the clinic's today in its zone, from four
 * modules in the one transaction of the read: the clinic's zone, hours and closed day (tenancy), the
 * providers, their breaks that weekday and the day's appointments (scheduling), and the appointments'
 * patients' names (patients). Put together here, as the patients module already reads scheduling's
 * (module rule 1), then laid out (./day.ts).
 */
export async function readDay(
  tx: TenantTransaction,
  asked: CalendarDay | null,
  now: Date,
): Promise<CalendarDayView> {
  const { timeZone } = await clinicPlace(tx);
  const today = dayInZone(now, timeZone);
  const day = asked ?? today;
  const weekday = isoWeekday(day);
  const hours = await openingHours(tx);
  const [closedDay = null] = await closedDaysBetween(tx, day, day);
  const providers = await listProviders(tx);
  const breaks = await breaksOnWeekday(tx, weekday);
  const appointments = await appointmentsOnDay(tx, day, timeZone);
  const names = await patientNames(
    tx,
    appointments.map((appointment) => appointment.patientId),
  );
  return layoutDay({
    day,
    today,
    weekday,
    hours,
    closedDay,
    providers,
    breaks,
    appointments: appointments.map((appointment) => {
      const patient = names.get(appointment.patientId);
      // The foreign key holds an appointment to a patient of its clinic: a missing name is loud.
      if (!patient) throw new Error("calendar: an appointment's patient was not found");
      return { ...appointment, patient };
    }),
  });
}

/**
 * The provider this person's membership in the clinic of the transaction is linked to, whose column
 * the calendar opens on (E01-T04b), or null. Read in the clinic's own transaction from the auth
 * module, not through clinics_for_user() (D-091, "Revisit if"); E01-T10 reads the same. It only
 * picks the columns shown first: no permission comes from it.
 */
export async function ownProvider(tx: TenantTransaction, userId: string): Promise<string | null> {
  return (await activeMembership(tx, userId))?.providerId ?? null;
}
