import type { CalendarDay } from '@/lib/calendar-day';
import { bookableProviders, type BookableProvider, type BookingChoices } from './booking-choices';
import { startChoicesWith, type PointedDay } from './move-choices';

/*
 * What the booking drawer offers on the day its Day field points at (E01-T06h): no React and no
 * database, so the rules are unit-tested. The move form does the same from its own state
 * (./appointment-move.tsx); the read of another day is theirs together (./pointed-day.ts).
 */

/** The starts and providers the drawer offers, and the provider chosen among them. */
export interface Offered {
  starts: number[];
  providers: BookableProvider[];
  /** The provider kept while the day offers it, else the day's first; '' when it offers none. */
  providerId: string;
}

/**
 * On the day the drawer opened on, what it offered then (`choices`: a read on use changes nothing
 * under an open drawer, D-108). On another day, that day's own once it is known (`day.state` is `ok`):
 * its grid's quarter hours with the start held always among them (`startChoicesWith`), so a change of
 * day never moves the time under the person, and its active providers, the one chosen kept while it is
 * active on that day. While that day is not known (its read is on its way or did not work), what the
 * drawer offered when it opened, with the start held among them: the server's check still counts.
 */
export function offeredOn(
  choices: BookingChoices,
  pointed: CalendarDay,
  day: PointedDay,
  start: number,
  providerId: string,
): Offered {
  const own = pointed === choices.day;
  const known = !own && day.state === 'ok';
  const providers = known ? bookableProviders(day.view.columns) : choices.providers;
  const starts = known
    ? startChoicesWith(day.view.grid, start)
    : choices.starts.includes(start)
      ? choices.starts
      : [...choices.starts, start].sort((a, b) => a - b);
  return {
    starts,
    providers,
    providerId: providers.some((found) => found.id === providerId)
      ? providerId
      : (providers[0]?.id ?? ''),
  };
}
