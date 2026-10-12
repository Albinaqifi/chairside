'use client';

import { useTimeZone, useTranslations } from 'next-intl';
import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import type { CalendarDay } from '@/lib/calendar-day';
import { Button } from '@/ui/button';
import { readCalendarDay } from './actions';
import type { CalendarDayView, CalendarRead } from './day';
import { DayCalendar } from './day-calendar';
import { firstChoice, shownColumns, toggleColumn, type ColumnChoice } from './filter';
import { MINUTE_MS, nowLineMinute, untilNextMinute } from './now-line';
import { readAgain, readIsDue, USE_EVENTS } from './read-on-use';

/** Why the day could not be read again: shown above the grid until a read works. */
type Problem = 'clinic_changed' | 'failed';

/**
 * The calendar's day in the browser (E01-T04b): the day the page read, drawn by DayCalendar, with
 * what the browser holds.
 * - The provider filter's choice (./filter.ts): the member's own column alone when their membership
 *   is linked to a provider, else every column; it holds over Previous, Today and Next, which render
 *   the page again in place, and over a read on use. The page keys this component by its clinic
 *   (D-098), so a render for another clinic starts again, and a reload does too.
 * - The "now" line (./now-line.ts), by the browser's clock in the clinic's zone, moved each minute
 *   without a request. Drawn once the page runs in the browser: the server's clock and the browser's
 *   differ, and a line drawn on both would not match.
 * - A fresh day on use (./read-on-use.ts, D-108): focus, a visible window, a pointer, a key or a touch
 *   reads the day again through the calendar's read, at most once every 30 seconds after the last
 *   read; never on a timer. An ended session sends that use to the login page (the read's wrapper,
 *   D-074).
 */
export function CalendarScreen({
  initial,
  asked,
}: {
  initial: CalendarRead;
  /** The day the page's address asks for, or null for the clinic's today. */
  asked: CalendarDay | null;
}) {
  const t = useTranslations();
  const clinicId = useFrameClinic();
  const timeZone = useTimeZone();
  const [choice, setChoice] = useState<ColumnChoice>(() => firstChoice(initial.ownProviderId));
  // A read on use, and a read that did not work, each for the page's render it followed: a later
  // render of the page (Previous, Today, Next) shows its own day, and an answer for an earlier one is
  // dropped.
  const [read, setRead] = useState<{ after: CalendarDayView; view: CalendarDayView } | null>(null);
  const [problem, setProblem] = useState<{ after: CalendarDayView; kind: Problem } | null>(null);
  const view = read !== null && read.after === initial.view ? read.view : initial.view;
  const shownProblem = problem !== null && problem.after === initial.view ? problem.kind : null;

  const lastReadAt = useRef(0);
  const reading = useRef(false);

  // Each render of the page is a read of the day: the next may come 30 seconds after it.
  useEffect(() => {
    lastReadAt.current = Date.now();
  }, [initial.view]);

  useEffect(() => {
    const after = initial.view;
    const onUse = () => {
      const at = Date.now();
      if (reading.current || !readIsDue(lastReadAt.current, at)) return;
      lastReadAt.current = at;
      reading.current = true;
      // In a transition, so Next.js's redirect after an ended session reaches its boundary.
      startTransition(async () => {
        try {
          const answer = await readAgain(readCalendarDay, clinicId, asked);
          if (answer.kind === 'read') {
            setRead({ after, view: answer.read.view });
            setProblem(null);
          } else {
            setProblem({ after, kind: answer.kind });
          }
        } finally {
          reading.current = false;
        }
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onUse();
    };
    for (const name of USE_EVENTS) window.addEventListener(name, onUse, { passive: true });
    window.addEventListener('focus', onUse);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      for (const name of USE_EVENTS) window.removeEventListener(name, onUse);
      window.removeEventListener('focus', onUse);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [clinicId, asked, initial.view]);

  const minute = useSyncExternalStore(everyMinute, currentMinute, noMinuteOnServer);
  // Every request names the clinic's zone (src/i18n/request.ts); without one, no line rather than
  // one in the computer's zone.
  const nowMinute =
    minute === null || timeZone === undefined
      ? null
      : nowLineMinute(new Date(minute), timeZone, view);
  const columnIds = view.columns.map((column) => column.providerId);

  return (
    <DayCalendar
      view={view}
      shown={shownColumns(choice, columnIds)}
      onToggle={(providerId) =>
        setChoice((current) => toggleColumn(current, columnIds, providerId))
      }
      nowMinute={nowMinute}
      notice={
        shownProblem === 'clinic_changed' ? (
          <div
            role="alert"
            className="mb-3 grid justify-items-start gap-2 rounded-control border border-warn-border bg-warn-bg px-3 py-2"
          >
            <p>{t('calendar.clinicChanged')}</p>
            <Button type="button" variant="secondary" onClick={() => window.location.reload()}>
              {t('form.reload')}
            </Button>
          </div>
        ) : shownProblem === 'failed' ? (
          <p role="alert" className="mb-3 rounded-control bg-error-bg px-3 py-2 text-error">
            {t('calendar.readFailed')}
          </p>
        ) : null
      }
    />
  );
}

/**
 * The browser's clock, to the minute, for useSyncExternalStore: the same value all minute long, so
 * the calendar draws again only when the minute changes. The browser's own timer, never a request.
 */
function currentMinute(): number {
  const now = Date.now();
  return now - (now % MINUTE_MS);
}

/** On the server, and while the page hydrates, no clock: the line is drawn once in the browser. */
function noMinuteOnServer(): null {
  return null;
}

/** Calls `changed` at each whole minute of the browser's clock, until unsubscribed. */
function everyMinute(changed: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const wait = () => {
    timer = setTimeout(() => {
      changed();
      wait();
    }, untilNextMinute(Date.now()));
  };
  wait();
  return () => clearTimeout(timer);
}
