'use client';

import { useTimeZone, useTranslations } from 'next-intl';
import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import type { CalendarDay } from '@/lib/calendar-day';
import { Button } from '@/ui/button';
import { readCalendarDay } from './actions';
import { AppointmentDrawer } from './appointment-drawer';
import { visitById, type CalendarDayView, type CalendarRead } from './day';
import { DayCalendar } from './day-calendar';
import { firstChoice, showColumn, shownColumns, toggleColumn, type ColumnChoice } from './filter';
import { NewAppointment, type NewAppointmentHandle } from './new-appointment';
import { MINUTE_MS, nowLineMinute, untilNextMinute } from './now-line';
import { readAgain, readIsDue, readTimeOf, USE_EVENTS } from './read-on-use';

/** Why the day could not be read again: shown above the grid until a read works. */
type Problem = 'clinic_changed' | 'failed';

/**
 * When each day the calendar showed was read, by the browser's clock (./read-on-use.ts, readTimeOf).
 * Outside the component, so it outlives a render for another day and a remount (Back from another
 * page); weak, so a day Next.js's router lets go of goes from here too. Written only in the browser.
 */
const readTimes = new WeakMap<CalendarDayView, number>();

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
 * - New appointment and its drawer (./new-appointment.tsx, E01-T05a), with the treatment types the
 *   last read brought. After a booking, the provider's column is turned on if the filter had it off.
 *   A click on an empty slot of the grid opens the same drawer on that slot (E01-T05c).
 * - The appointment drawer (./appointment-drawer.tsx, E01-T06b): a click or Enter on a visit's block
 *   opens it. What is kept is the opened visit's id; the visit shown is looked up in the day held now,
 *   in every column (the filter hides columns, not visits), so a read on use or a change's answer
 *   updates it, and a visit the day no longer holds closes it.
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
  const [read, setRead] = useState<{ after: CalendarDayView; read: CalendarRead } | null>(null);
  const [problem, setProblem] = useState<{ after: CalendarDayView; kind: Problem } | null>(null);
  const current = read !== null && read.after === initial.view ? read.read : initial;
  const view = current.view;
  const shownProblem = problem !== null && problem.after === initial.view ? problem.kind : null;

  const lastReadAt = useRef(0);
  const reading = useRef(false);
  const booking = useRef<NewAppointmentHandle>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  // The next read may come 30 seconds after the read of the day shown: a day the page rendered was
  // read when the browser first drew it, a day a read on use brought when that read started. A day
  // Back or Forward shows again is the same day, so it keeps its time (readTimes).
  useEffect(() => {
    lastReadAt.current = readTimeOf(readTimes, view, Date.now());
  }, [view]);

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
            readTimes.set(answer.read.view, at);
            setRead({ after, read: answer.read });
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
  const shown = shownColumns(choice, columnIds);
  const opened = openId === null ? null : visitById(view, openId);
  // A visit the day no longer holds (read again without it, or another day shown): the drawer is
  // closed for good, so a visit that comes back is not opened again. State set while rendering, as
  // React allows for state that follows what the render found.
  if (openId !== null && opened === null) setOpenId(null);

  return (
    <DayCalendar
      view={view}
      shown={shown}
      onToggle={(providerId) => setChoice((before) => toggleColumn(before, columnIds, providerId))}
      nowMinute={nowMinute}
      onSlot={(slot, at) => booking.current?.openAt(slot, at)}
      onOpen={setOpenId}
      newAppointment={
        <NewAppointment
          ref={booking}
          view={view}
          treatmentTypes={current.treatmentTypes}
          shown={shown}
          onBooked={(providerId) =>
            setChoice((before) => showColumn(before, columnIds, providerId))
          }
        />
      }
      appointmentDrawer={
        opened && (
          <AppointmentDrawer
            key={opened.block.id}
            block={opened.block}
            column={opened.column}
            year={view.day.slice(0, 4) !== view.today.slice(0, 4)}
            onClose={() => setOpenId(null)}
          />
        )
      }
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
