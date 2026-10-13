'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { ClosedDay } from '@/modules/tenancy';
import { Input } from '@/ui/input';
import { addClosedDay, removeClosedDay } from './actions';

/** A closed day is a calendar date, no moment: shown on its own day in every zone (D-098). */
const CLOSED_DATE = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
} as const;

/**
 * The Opening hours tab's closed days (E01-T08c; the demo has none, design-reference.md): the
 * clinic's closed days from its today on, each with its label and a Remove, or one line when none is
 * ahead; then a form that adds one by its date, the browser's own date field, and a label. It stands
 * under the week's form, never inside it: a form holds no other form. Its page keys it by the clinic
 * (D-098), so a render for another clinic starts it from that clinic's days.
 *
 * Every form here is a StaffForm: it sends the frame's clinic (D-092) and keeps nothing in the browser
 * (D-093), no field asking for an `autocomplete` of its own. When an add or a Remove is done, the
 * action renders the page again (refresh()), and the list with it.
 *
 * After an add, the add form is mounted anew, so its two fields are empty again (React keeps what was
 * typed in a field while its element stays) and the keyboard is back at the date, for the next one.
 * After a Remove, whose row then leaves the list, the keyboard goes to the section's heading, as the
 * button it was on is gone.
 */
export function ClosedDays({ days }: { days: readonly ClosedDay[] }) {
  const t = useTranslations('settings.hours.closedDays');
  const heading = useRef<HTMLHeadingElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added > 0) dateField.current?.focus();
  }, [added]);
  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        {/* tabIndex -1: the keyboard's place after a Remove, never a stop of the Tab key. */}
        <h2 ref={heading} tabIndex={-1} className="text-section font-semibold">
          {t('heading')}
        </h2>
        <p className="text-muted">{t('intro')}</p>
      </div>
      {days.length === 0 ? (
        <p>{t('none')}</p>
      ) : (
        <ul>
          {days.map((day) => (
            <ClosedDayRow key={day.date} day={day} onRemoved={() => heading.current?.focus()} />
          ))}
        </ul>
      )}
      <StaffForm
        key={added}
        action={addClosedDay}
        doneMessage={t('added')}
        onDone={() => setAdded((count) => count + 1)}
        refusals={{ already_closed: t('alreadyClosed'), in_the_past: t('inThePast') }}
        submitLabel={t('add')}
        pendingLabel={t('adding')}
        className="border-t border-border pt-4"
      >
        {/* items-start: a field with a line under it makes its row taller, never its neighbour.
            The columns are the rows': the Label field under the labels of the list. */}
        <div className="grid items-start gap-4 sm:grid-cols-[16rem_1fr]">
          <StaffField
            name="date"
            label={t('date')}
            render={(field) => <Input {...field} ref={dateField} type="date" />}
          />
          <StaffField name="label" label={t('label')} render={(field) => <Input {...field} />} />
        </div>
      </StaffForm>
    </section>
  );
}

/**
 * One closed day: its date, its label and its Remove, a StaffForm of its own whose only field is the
 * date, hidden, and whose button sends it. A group named by the date, so the Remove is read with the
 * day it removes. A refusal stands above the button, as in every staff form; the row then wraps and
 * gives it the row's width.
 */
function ClosedDayRow({ day, onRemoved }: { day: ClosedDay; onRemoved: () => void }) {
  const t = useTranslations('settings.hours.closedDays');
  const format = useFormatter();
  const date = format.dateTime(new Date(day.date), CLOSED_DATE);
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div
        role="group"
        aria-label={date}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      >
        {/* The columns are the add form's, so a label stands over the Label field. */}
        <div className="grid min-w-0 flex-1 gap-x-4 sm:grid-cols-[16rem_1fr]">
          <span className="font-medium">{date}</span>
          <span className="wrap-anywhere">{day.label}</span>
        </div>
        <StaffForm
          action={removeClosedDay}
          doneMessage={t('removed')}
          onDone={onRemoved}
          refusals={{ not_closed: t('notClosed'), in_the_past: t('removePast') }}
          submitLabel={t('remove')}
          pendingLabel={t('removing')}
          className="justify-items-end"
        >
          <input type="hidden" name="date" value={day.date} />
        </StaffForm>
      </div>
    </li>
  );
}
