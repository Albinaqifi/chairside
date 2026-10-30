'use client';

import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import { startTransition, useEffect, useId, useRef, useState } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import { useFrameClinic } from '@/app/_lib/frame-clinic';
import type { CalendarDay } from '@/lib/calendar-day';
import { cn } from '@/ui/cn';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { readCalendarDay } from './actions';
import { moveAppointment } from './appointment-actions';
import { bookableProviders, minutesOfStart, startValue } from './booking-choices';
import { BookingWarning, TIME_OF_DAY } from './booking-warning';
import { bookingWarnings, NO_WARNINGS } from './booking-warnings';
import { isShownDay, type AppointmentBlock, type CalendarDayView, type Column } from './day';
import {
  firstMoveProvider,
  placeOf,
  pointedDay,
  startChoicesWith,
  type OtherDay,
} from './move-choices';
import { readAgain } from './read-on-use';

/**
 * The appointment drawer's move form (E01-T06f; the action is E01-T06c's): a date, a time and a
 * provider, each starting on the visit's own, and Move under them. A StaffForm calling
 * `moveAppointment` with the visit hidden. The length stays (the action keeps it), so there is no
 * length field. The form is keyed by the visit's place in the drawer, so a move, or another desk's
 * move seen in a read on use, starts it again from the new place and no old typing carries over.
 *
 * Above Move, what the day it points at warns of (./booking-warning.tsx, the booking's own box): the
 * day the calendar holds when that is the day, else that day read through the calendar's read when the
 * date changes to a complete day (the browser gives an empty value while it is half typed). Only the
 * last answer counts and the old warnings stay until the new one comes; a read that did not work
 * empties the box and a line says the day could not be checked. The server's check is the one that
 * counts: an overlap is refused whatever the box showed. That day's grid and active providers also
 * give the times and providers offered, and the time held is offered even when no grid has it, so a
 * change of day never moves the time under the person. An overlap turns Move into Move anyway and adds
 * the hidden `anyway`, sent only while it shows (D-020); a break, the hours or a closed day leave Move
 * as it is. The visit's own old place is no overlap.
 *
 * After a move the calendar keeps the day it shows: a move on that day shows the visit in its new
 * place and the drawer on it, a move to another day takes the visit off the day and closes the drawer
 * (./calendar-screen.tsx). The press of a double click that lands on Move after the answer is dropped
 * for a moment (`settling`, ./appointment-drawer.tsx): the form is then a new one, and its press would
 * send "nothing changed" over a success.
 */
export function MoveForm(props: {
  block: AppointmentBlock;
  column: Column;
  /** The day the calendar holds now. */
  held: CalendarDayView;
  /** The drawer's one-second settle after the visit's place or buttons change: no pointer press. */
  settling: boolean;
  onSendingChange: (sending: boolean) => void;
  /** After the toast, with the provider the visit moved to. */
  onMoved: (providerId: string) => void;
}) {
  const timeZone = useTimeZone();
  // Every request names the clinic's zone (src/i18n/request.ts); without one, no form rather than
  // one that starts a visit on the computer's day.
  return timeZone === undefined ? null : <MoveFields {...props} timeZone={timeZone} />;
}

function MoveFields({
  block,
  column,
  held,
  settling,
  onSendingChange,
  onMoved,
  timeZone,
}: Parameters<typeof MoveForm>[0] & { timeZone: string }) {
  const t = useTranslations('calendar.appointment.move');
  const booking = useTranslations('calendar.booking');
  const names = useTranslations('patients');
  const format = useFormatter();
  const clinicId = useFrameClinic();
  const heading = useId();
  const [place] = useState(() => placeOf(block.startsAt, block.endsAt, timeZone));
  const [move, setMove] = useState({
    day: place.day as string,
    start: place.start,
    providerId: firstMoveProvider(held.columns, column),
  });
  // The last complete day typed: the day the warnings and choices are of while a date is half typed.
  const [pointed, setPointed] = useState<CalendarDay>(place.day);
  const [other, setOther] = useState<OtherDay | null>(null);
  // Bumped when a send is over, so another day's warnings are read again: a refusal such as an overlap
  // says another desk booked the slot, and the calendar's own refresh brings only the day it holds.
  const [again, setAgain] = useState(0);

  // Another day's read, for the day pointed at. Each run is a ticket: a change of day, a later send
  // or the form leaving the page makes the answer of an earlier one drop, so the last answer wins.
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

  const { view, state } = pointedDay(pointed, held, other, place.day);
  const providers = bookableProviders(view.columns);
  const providerId = providers.some((found) => found.id === move.providerId)
    ? move.providerId
    : (providers[0]?.id ?? '');
  const provider = providers.find((found) => found.id === providerId) ?? null;
  const warnings =
    state === 'ok'
      ? bookingWarnings(view, { providerId, start: move.start, length: place.length }, block.id)
      : NO_WARNINGS;
  const anyway = warnings.overlaps.length > 0;
  const time = (minutes: number) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minutes)), TIME_OF_DAY);
  const patient = names('fullName', {
    first: block.patient.firstName,
    last: block.patient.lastName,
  });
  // The toast names where the visit goes: a date is no moment, so it is formatted in UTC (D-098).
  const toDay = isShownDay(move.day)
    ? format.dateTime(new Date(move.day), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: move.day.slice(0, 4) === held.today.slice(0, 4) ? undefined : 'numeric',
        timeZone: 'UTC',
      })
    : '';

  return (
    <section aria-labelledby={heading}>
      <h3 id={heading} className="mb-2 text-small font-semibold">
        {t('heading')}
      </h3>
      <StaffForm
        action={moveAppointment}
        doneMessage={t('moved', { name: patient, day: toDay, time: time(move.start) })}
        onDone={(value) => onMoved(value.providerId)}
        refusals={{
          overlap: t('refusals.overlap'),
          already_booked: t('refusals.alreadyBooked'),
          provider_not_bookable: t('refusals.providerNotBookable'),
          patient_not_bookable: t('refusals.patientNotBookable'),
          start_skipped: t('refusals.startSkipped'),
          nothing_changed: t('refusals.nothingChanged'),
          not_movable: t('refusals.notMovable'),
          not_found: t('refusals.notFound'),
        }}
        submitLabel={anyway ? t('moveAnyway') : t('submit')}
        pendingLabel={t('moving')}
        onSendingChange={(sending) => {
          onSendingChange(sending);
          if (!sending) setAgain((count) => count + 1);
        }}
        className={cn(settling && '[&_button]:pointer-events-none')}
      >
        <input type="hidden" name="appointmentId" value={block.id} />
        {anyway && <input type="hidden" name="anyway" value="true" />}
        {/*
          The form's last child: StaffForm puts its refusal's message and Move right under it. The
          warning shares it with the fields, so its live region, empty, adds no gap above Move.
        */}
        <div>
          <div className="grid grid-cols-2 gap-2.5">
            <StaffField
              name="day"
              label={t('day')}
              render={(field) => (
                <Input
                  {...field}
                  type="date"
                  value={move.day}
                  onChange={(event) => {
                    const day = event.currentTarget.value;
                    setMove((before) => ({ ...before, day }));
                    if (isShownDay(day)) setPointed(day);
                  }}
                />
              )}
            />
            <StaffField
              name="start"
              label={t('start')}
              render={(field) => (
                <NativeSelect
                  {...field}
                  value={startValue(move.start)}
                  onChange={(event) => {
                    const start = minutesOfStart(event.currentTarget.value);
                    if (start !== null) setMove((before) => ({ ...before, start }));
                  }}
                >
                  {startChoicesWith(view.grid, move.start).map((minutes) => (
                    <NativeSelectOption key={minutes} value={startValue(minutes)}>
                      {time(minutes)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            />
            <StaffField
              name="providerId"
              label={t('provider')}
              className="col-span-2"
              render={(field) =>
                providers.length === 0 ? (
                  // Disabled, so nothing is sent: Move then says the field needs a provider.
                  <NativeSelect {...field} disabled defaultValue="">
                    <NativeSelectOption value="">{booking('noProviders')}</NativeSelectOption>
                  </NativeSelect>
                ) : (
                  <NativeSelect
                    {...field}
                    value={providerId}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      setMove((before) => ({ ...before, providerId: next }));
                    }}
                  >
                    {providers.map((option) => (
                      <NativeSelectOption key={option.id} value={option.id}>
                        {option.shortName}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )
              }
            />
          </div>
          <BookingWarning
            move
            warnings={warnings}
            day={view.day}
            providerName={provider?.shortName ?? ''}
          />
          <div role="status">
            {state === 'failed' && <p className="mt-3 text-muted">{t('couldNotCheck')}</p>}
          </div>
        </div>
      </StaffForm>
    </section>
  );
}
