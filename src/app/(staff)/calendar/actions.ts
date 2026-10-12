'use server';

import { z } from 'zod';
import { staffRead } from '@/app/_lib/actions';
import { isShownDay } from './day';
import { readDay } from './read-day';

/**
 * The calendar's day (E01-T04a): the page reads it with forPage, the day its address asks for or
 * null for the clinic's today; E01-T04b reads it again when the calendar is used. Every role has
 * calendar.manage (scope-v1.md, "Navigation and roles"). No audit row: a calendar is a list, not a
 * patient record view (D-098, security-privacy.md section 10).
 */
export const readCalendarDay = staffRead(
  {
    permission: 'calendar.manage',
    input: z.object({ day: z.string().refine(isShownDay).nullable() }),
  },
  async ({ input, tx, now }) => readDay(tx, input.day, now),
);
