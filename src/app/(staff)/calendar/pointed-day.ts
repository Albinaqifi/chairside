import { startTransition, useEffect, useRef, useState } from 'react';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import type { CalendarDay } from '@/lib/calendar-day';
import { readCalendarDay } from './actions';
import type { CalendarDayView } from './day';
import { pointedDay, type OtherDay, type PointedDay } from './move-choices';
import { readAgain } from './read-on-use';

/**
 * The read of another day, for the two forms that have a day field (the move form, E01-T06f, and the
 * booking drawer's, E01-T06h): what the day pointed at, the last complete date typed, holds. The day
 * the calendar holds is read from it, never again; another day is read through the calendar's read
 * when the form points at it (./move-choices.ts, `pointedDay`, tells what the answer is).
 *
 * Each run of the read is a ticket: a change of day, a later send (`readAgainAfterSend`) or the form
 * leaving the page makes the answer of an earlier one drop, so the last answer wins. A send that is
 * over asks again: a refusal such as an overlap says another desk booked the slot, and the calendar's
 * own refresh brings only the day it holds.
 */
export function usePointedDay(
  pointed: CalendarDay,
  held: CalendarDayView,
  started: CalendarDay,
): PointedDay & { readAgainAfterSend: () => void } {
  const clinicId = useFrameClinic();
  const [other, setOther] = useState<OtherDay | null>(null);
  const [again, setAgain] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    if (pointed === held.day) return;
    const ticket = ++latest.current;
    // In a transition, so Next.js's redirect after an ended session reaches its boundary.
    startTransition(async () => {
      const answer = await readAgain(readCalendarDay, clinicId, pointed);
      if (ticket !== latest.current) return;
      setOther({ day: pointed, view: answer.kind === 'read' ? answer.read.view : null });
    });
    return () => {
      latest.current += 1;
    };
  }, [pointed, held.day, clinicId, again]);
  return {
    ...pointedDay(pointed, held, other, started),
    readAgainAfterSend: () => setAgain((count) => count + 1),
  };
}
