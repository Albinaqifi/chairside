import { and, asc, gte, lte, sql, type Column } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';
import { clinicHours, closedDays } from './schema';

/** When the clinic opens on one weekday, on its clock: local times in its zone. */
export interface OpeningHours {
  /** ISO, 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Minutes from midnight to the opening: 480 is 08:00. */
  opens: number;
  /** Minutes from midnight to the closing. */
  closes: number;
}

/**
 * The clinic's opening hours, a row per weekday it opens, by weekday. A weekday without a row is
 * closed (data-model.md section 1).
 */
export async function openingHours(tx: TenantTransaction): Promise<OpeningHours[]> {
  return tx
    .select({
      weekday: clinicHours.weekday,
      opens: minutesOfTime(clinicHours.opens),
      closes: minutesOfTime(clinicHours.closes),
    })
    .from(clinicHours)
    .orderBy(asc(clinicHours.weekday));
}

/** A day the clinic is closed although its hours say open: a holiday. */
export interface ClosedDay {
  date: CalendarDay;
  label: string;
}

/** The clinic's closed days from `first` to `last`, both included, by date. */
export async function closedDaysBetween(
  tx: TenantTransaction,
  first: CalendarDay,
  last: CalendarDay,
): Promise<ClosedDay[]> {
  return tx
    .select({ date: closedDays.date, label: closedDays.label })
    .from(closedDays)
    .where(and(gte(closedDays.date, first), lte(closedDays.date, last)))
    .orderBy(asc(closedDays.date));
}

/** A `time` column as minutes from midnight: seconds since midnight, over 60. */
function minutesOfTime(column: Column) {
  return sql<number>`(extract(epoch from ${column}) / 60)::float8`;
}
