'use server';

import { z } from 'zod';
import { staffRead } from '@/app/_lib/actions';
import { isShownDay, type CalendarRead } from './day';
import { ownProvider, readDay } from './read-day';

/**
 * The calendar's day (E01-T04a): the page reads it with forPage, the day its address asks for or
 * null for the clinic's today; the calendar reads it again from the browser when it is used, at most
 * once every 30 seconds (E01-T04b, D-108). With it, the provider the reader's membership is linked
 * to, whose column the calendar opens on (E01-T04b). Every role has calendar.manage (scope-v1.md,
 * "Navigation and roles"). No audit row: a calendar is a list, not a patient record view (D-098,
 * security-privacy.md section 10).
 */
export const readCalendarDay = staffRead(
  {
    permission: 'calendar.manage',
    input: z.object({ day: z.string().refine(isShownDay).nullable() }),
  },
  async ({ input, tx, staff, now }): Promise<CalendarRead> => ({
    view: await readDay(tx, input.day, now),
    ownProviderId: await ownProvider(tx, staff.user.id),
  }),
);
