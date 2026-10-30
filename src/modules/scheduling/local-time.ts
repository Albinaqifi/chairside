import { sql, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import type { CalendarDay } from '@/lib/calendar-day';

/**
 * The moments of a start on the clinic's clock (E01-T05a, shared with a move by E01-T06c). The moments
 * stay in SQL, from the overlap check to the write: PostgreSQL alone turns a local time into one, so
 * no moment is read back and parsed in code.
 *
 * `localStart` is the day's local midnight plus the minutes, `startsAt` that local time in the
 * clinic's zone (`AT TIME ZONE`), so 09:00 is 09:00 on the days the clocks change too.
 */
export interface StartMoments {
  localStart: SQL;
  startsAt: SQL;
}

/** The start `startMinute` minutes after the local midnight of `day`, in `timeZone`. */
export function startMoments(
  day: CalendarDay,
  startMinute: number,
  timeZone: string,
): StartMoments {
  const localStart = sql`(${day}::date::timestamp + make_interval(mins => ${startMinute}))`;
  return { localStart, startsAt: sql`(${localStart} at time zone ${timeZone})` };
}

/**
 * False when the clocks skip that local time on that day (the night summer time starts): it has no
 * moment, and PostgreSQL would read it an hour later. Such a start is refused (`start_skipped`), never
 * stored an hour later. A local time that comes twice (the night summer time ends) is the second, in
 * standard time, as PostgreSQL reads it.
 */
export async function startExists(
  tx: TenantTransaction,
  { localStart, startsAt }: StartMoments,
  timeZone: string,
): Promise<boolean> {
  const checked = await tx.execute<{ on_its_day: boolean }>(
    sql`select (${startsAt} at time zone ${timeZone}) = ${localStart} as on_its_day`,
  );
  return checked.rows[0]?.on_its_day === true;
}
