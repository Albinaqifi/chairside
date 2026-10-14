import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { dayInZone, isCalendarDay, type CalendarDay } from '@/lib/calendar-day';
import { clinicPlace } from './clinic-place';
import type { ClosedDay } from './hours';
import { closedDays } from './schema';

/*
 * The clinic's closed days, kept from Settings (E01-T08c): a day the clinic is closed although its
 * hours say open, a holiday, by its date (data-model.md section 1). A date is the clinic's own, no
 * moment: "today" is the day it is in the clinic's zone at the caller's `now` (D-015). Only today and
 * the days after it are listed, added and removed; a past one stays as it is.
 */

/** The longest a closed day's label may be, in characters, once trimmed. */
export const CLOSED_DAY_LABEL_MAX = 100;

/** The clinic's closed days from its today on, by date: the ones Settings lists. */
export async function closedDaysAhead(tx: TenantTransaction, now: Date): Promise<ClosedDay[]> {
  const today = await clinicToday(tx, now);
  return tx
    .select({ date: closedDays.date, label: closedDays.label })
    .from(closedDays)
    .where(gte(closedDays.date, today))
    .orderBy(asc(closedDays.date));
}

/**
 * Why a closed day was not added: a date before the clinic's today, or one it is closed on already
 * (added meanwhile in another tab too).
 */
export type AddClosedDayRefusal = 'in_the_past' | 'already_closed';

export type AddClosedDayResult = { ok: true } | { ok: false; code: AddClosedDayRefusal };

/**
 * Closes the clinic of this transaction on `day.date`, with its label trimmed, created and updated at
 * `now`. A date before the clinic's today is refused before it reaches PostgreSQL, which takes no
 * year 0 (isCalendarDay does). The insert does nothing when the clinic has the date already, on its
 * unique key `(clinic_id, date)` (migration 0002): so of two adds of one date at once, the second waits
 * for the first and is answered `already_closed`, with no lock on the clinic's row and never a
 * failure. A date that is no calendar day, or a label empty or too long once trimmed, is an Error:
 * the caller's schema refuses them first, each at its field.
 */
export async function addClosedDay(
  tx: TenantTransaction,
  day: ClosedDay,
  now: Date,
): Promise<AddClosedDayResult> {
  const label = day.label.trim();
  if (!isCalendarDay(day.date) || label === '' || label.length > CLOSED_DAY_LABEL_MAX) {
    throw new Error('addClosedDay: the closed day cannot be stored');
  }
  if (day.date < (await clinicToday(tx, now))) return { ok: false, code: 'in_the_past' };
  const added = await tx
    .insert(closedDays)
    .values({
      clinicId: sql`current_clinic_id()`,
      date: day.date,
      label,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: [closedDays.clinicId, closedDays.date] })
    .returning({ id: closedDays.id });
  return added.length > 0 ? { ok: true } : { ok: false, code: 'already_closed' };
}

/**
 * Why a closed day was not removed: a date before the clinic's today, or one it is not closed on (it
 * was removed meanwhile, in another tab).
 */
export type RemoveClosedDayRefusal = 'in_the_past' | 'not_closed';

export type RemoveClosedDayResult = { ok: true } | { ok: false; code: RemoveClosedDayRefusal };

/**
 * Opens the day `date` again for the clinic of this transaction: its row deleted (the app role's
 * DELETE, migration 0002). A date before the clinic's today is refused before it reaches PostgreSQL,
 * and its row kept. No row for the date is `not_closed`; of two removes at once, the second waits
 * for the first's delete and finds none. A date that is no calendar day is an Error.
 */
export async function removeClosedDay(
  tx: TenantTransaction,
  date: CalendarDay,
  now: Date,
): Promise<RemoveClosedDayResult> {
  if (!isCalendarDay(date)) throw new Error('removeClosedDay: needs a day as YYYY-MM-DD');
  if (date < (await clinicToday(tx, now))) return { ok: false, code: 'in_the_past' };
  // Row-Level Security holds the statement to the clinic of this transaction; its own row is named
  // too, as saveOpeningHours names it.
  const removed = await tx
    .delete(closedDays)
    .where(and(eq(closedDays.clinicId, sql`current_clinic_id()`), eq(closedDays.date, date)))
    .returning({ id: closedDays.id });
  return removed.length > 0 ? { ok: true } : { ok: false, code: 'not_closed' };
}

/**
 * The day it is in the clinic's zone at `now`. Two `YYYY-MM-DD` days compare as text in the order of
 * the calendar, as isCalendarDay holds both to four digits of year.
 */
async function clinicToday(tx: TenantTransaction, now: Date): Promise<CalendarDay> {
  const { timeZone } = await clinicPlace(tx);
  return dayInZone(now, timeZone);
}
