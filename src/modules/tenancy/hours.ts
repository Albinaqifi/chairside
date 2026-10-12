import { and, asc, eq, gte, lte, sql, type Column } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';
import { clinicHours, clinics, closedDays } from './schema';

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

/** The ISO weekdays, Monday first. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Minutes in a day: a `time` runs from 00:00 up to 24:00, which PostgreSQL also holds. */
const DAY_MINUTES = 24 * 60;

/** What a save of the week changed: the ISO weekdays whose hours differ from before, in order. */
export interface SaveHoursResult {
  changed: number[];
}

/**
 * Sets the opening hours of the clinic of this transaction (E01-T08b): `week` holds each weekday it
 * opens, once; a weekday not in it is closed, so it keeps no row (data-model.md section 1). Each
 * weekday whose hours differ is inserted, updated with updated_at from `now`, or deleted; one whose
 * hours are the same is not written. Gives the weekdays changed, for the audit row. Times are
 * compared to the second, as a `time` the form offers as it is (08:10) comes back as it was read.
 *
 * Hours the caller's schema should have refused are an Error: a weekday outside 1–7 or given twice,
 * a time outside the day, a closing at or before its opening. The clinic's row is locked first, as
 * saveClinicDetails locks it, so of two saves at once the second waits, reads the first's hours,
 * names only its own changes, and never inserts a weekday the first has just inserted.
 */
export async function saveOpeningHours(
  tx: TenantTransaction,
  week: readonly OpeningHours[],
  now: Date,
): Promise<SaveHoursResult> {
  const next = new Map<number, OpeningHours>();
  for (const hours of week) {
    if (!isSavable(hours) || next.has(hours.weekday)) {
      throw new Error('saveOpeningHours: the hours cannot be stored');
    }
    next.set(hours.weekday, hours);
  }
  const [clinic] = await tx
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.id, sql`current_clinic_id()`))
    .for('update');
  if (!clinic) throw new Error('saveOpeningHours: the clinic of this transaction was not found');
  const before = new Map((await openingHours(tx)).map((hours) => [hours.weekday, hours]));
  const changed: number[] = [];
  for (const weekday of WEEKDAYS) {
    const was = before.get(weekday);
    const will = next.get(weekday);
    if (sameHours(was, will)) continue;
    changed.push(weekday);
    // Row-Level Security holds each statement to the clinic of this transaction; its own row is
    // named too, as an insert names it.
    const thisWeekday = and(
      eq(clinicHours.clinicId, sql`current_clinic_id()`),
      eq(clinicHours.weekday, weekday),
    );
    if (!will) {
      await tx.delete(clinicHours).where(thisWeekday);
    } else if (!was) {
      await tx.insert(clinicHours).values({
        clinicId: sql`current_clinic_id()`,
        weekday,
        opens: timeOfMinutes(will.opens),
        closes: timeOfMinutes(will.closes),
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await tx
        .update(clinicHours)
        .set({
          opens: timeOfMinutes(will.opens),
          closes: timeOfMinutes(will.closes),
          updatedAt: now,
        })
        .where(thisWeekday);
    }
  }
  return { changed };
}

/** True for hours a row can hold: a weekday 1–7, and 00:00 ≤ opens < closes ≤ 24:00. */
function isSavable({ weekday, opens, closes }: OpeningHours): boolean {
  return (
    (WEEKDAYS as readonly number[]).includes(weekday) &&
    Number.isFinite(opens) &&
    Number.isFinite(closes) &&
    opens >= 0 &&
    secondsOf(opens) < secondsOf(closes) &&
    closes <= DAY_MINUTES
  );
}

/** Both closed, or both open from the same second to the same second. */
function sameHours(a: OpeningHours | undefined, b: OpeningHours | undefined): boolean {
  if (!a || !b) return a === b;
  return secondsOf(a.opens) === secondsOf(b.opens) && secondsOf(a.closes) === secondsOf(b.closes);
}

/** Minutes from midnight as whole seconds: a float of minutes never compared as it is. */
function secondsOf(minutes: number): number {
  return Math.round(minutes * 60);
}

/** Minutes from midnight as a `time`'s text, `HH:MM:SS`: 490 is 08:10:00, 1440 is 24:00:00. */
function timeOfMinutes(minutes: number): string {
  const seconds = secondsOf(minutes);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
}
