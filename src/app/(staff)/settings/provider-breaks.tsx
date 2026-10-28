'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { ClinicBreak, ClinicProvider } from '@/modules/scheduling';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/ui/dialog';
import { Input } from '@/ui/input';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { addBreak, removeBreak } from './provider-actions';
import { minutesOfTimeValue, timeChoices, WEEKDAY_FIELDS } from './opening-hours';

/**
 * How long the breaks' list takes no click from a pointer once its rows have changed: the closed
 * days' and the providers' moment (SETTLE_MS in ./closed-days.tsx and ./providers.tsx), copied a fifth
 * time rather than shared (E01-T09e). A Remove's row leaves, and the next break's Remove moves up
 * under the resting pointer, where a double click's second press would remove that break too.
 */
const SETTLE_MS = 1_000;

/** The times a new break's selects start at: lunch, 12:00 to 13:00. */
const FIRST_STARTS = '12:00';
const FIRST_ENDS = '13:00';

/**
 * A provider's Breaks: a button that opens a dialog of the provider's weekly breaks (E01-T09e; the
 * demo has none, design-reference.md), as Edit opens its form. The dialog's content is mounted only
 * while it is open, so each opening starts from the breaks of that render.
 */
export function ProviderBreaks({
  provider,
  breaks,
}: {
  provider: ClinicProvider;
  /** Every break of the provider, by weekday and start. */
  breaks: readonly ClinicBreak[];
}) {
  const t = useTranslations('settings.providers');
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary">{t('breaks')}</Button>
      </DialogTrigger>
      <DialogContent
        title={t('breaksTitle', { name: provider.name })}
        description={t('breaksIntro')}
      >
        <BreaksPanel provider={provider} breaks={breaks} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dialog's content: the provider's breaks by weekday and start, each with its Remove, or one line
 * when there is none, and under a line the form that adds one. Exported for its component test: the
 * dialog's content is mounted only while it is open, so the server's HTML of the tab has none of it.
 *
 * Every form here is a StaffForm: it sends the frame's clinic (D-092) and keeps nothing in the browser
 * (D-093), no field asking for an `autocomplete` of its own; a form holds no other form, the rows'
 * Remove forms standing beside the add form. When one is done the action renders the page again
 * (refresh()), and the list with it. After an add, the add form is mounted anew, empty, and the
 * keyboard is at its weekday, for the next one. After a Remove, whose row leaves, the keyboard goes
 * to the list's heading, as the button it was on is gone. Whenever the rows change, the list takes no
 * pointer click for a moment (SETTLE_MS), as the closed days': only the pointer's.
 */
export function BreaksPanel({
  provider,
  breaks,
}: {
  provider: ClinicProvider;
  breaks: readonly ClinicBreak[];
}) {
  const t = useTranslations('settings.providers');
  const heading = useRef<HTMLHeadingElement>(null);
  const weekdayField = useRef<HTMLSelectElement>(null);
  const [added, setAdded] = useState(0);
  useEffect(() => {
    if (added > 0) weekdayField.current?.focus();
  }, [added]);
  // The rows as last rendered, compared while rendering, as the closed days' list compares them:
  // the commit that changes the rows is the one that stops their clicks.
  const listed = JSON.stringify(breaks);
  const [rendered, setRendered] = useState(listed);
  const [settling, setSettling] = useState(false);
  if (rendered !== listed) {
    setRendered(listed);
    setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling, listed]);
  const format = useFormatter();
  const labels = timeLabelsOf(format);
  return (
    <div className="grid gap-4">
      {/* tabIndex -1: the keyboard's place after a Remove, never a stop of the Tab key. */}
      <h3 ref={heading} tabIndex={-1} className="font-semibold">
        {t('breaksHeading')}
      </h3>
      {breaks.length === 0 ? (
        <p>{t('breaksNone')}</p>
      ) : (
        <ul className={settling ? 'pointer-events-none' : undefined}>
          {breaks.map((each) => (
            <BreakRow
              key={each.id}
              each={each}
              labels={labels}
              onRemoved={() => heading.current?.focus()}
            />
          ))}
        </ul>
      )}
      <StaffForm
        key={added}
        action={addBreak}
        doneMessage={t('breakAdded')}
        onDone={() => setAdded((count) => count + 1)}
        refusals={{ break_overlaps: t('breakOverlaps'), not_found: t('notFound') }}
        submitLabel={t('breakAdd')}
        pendingLabel={t('breakAdding')}
        className="border-t border-border pt-4"
      >
        <input type="hidden" name="providerId" value={provider.id} />
        {/* items-start: a field with a line under it makes its row taller, never its neighbour. */}
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <StaffField
            name="weekday"
            label={t('breakWeekday')}
            render={(field) => (
              <NativeSelect {...field} ref={weekdayField} defaultValue="1">
                {WEEKDAY_FIELDS.map(({ weekday }) => (
                  <NativeSelectOption key={weekday} value={String(weekday)}>
                    {labels.weekday(weekday)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <StaffField
            name="starts"
            label={t('breakStarts')}
            render={(field) => (
              <NativeSelect {...field} defaultValue={FIRST_STARTS}>
                {timeChoices(FIRST_STARTS).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {labels.time(value)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <StaffField
            name="ends"
            label={t('breakEnds')}
            render={(field) => (
              <NativeSelect {...field} defaultValue={FIRST_ENDS}>
                {timeChoices(FIRST_ENDS).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {labels.time(value)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <StaffField
            name="label"
            label={t('breakLabel')}
            className="sm:col-span-3"
            render={(field) => <Input {...field} />}
          />
        </div>
      </StaffForm>
    </div>
  );
}

/**
 * One break: its weekday, its times and its label, and its Remove, a StaffForm of its own whose only
 * field is the break's id, hidden. A group named by all three, so the Remove is read with the break it
 * removes. A refusal stands above the button, as in every staff form.
 */
function BreakRow({
  each,
  labels,
  onRemoved,
}: {
  each: ClinicBreak;
  labels: TimeLabels;
  onRemoved: () => void;
}) {
  const t = useTranslations('settings.providers');
  const weekday = labels.weekday(each.weekday);
  const times = t('breakTimes', { from: labels.time(each.starts), to: labels.time(each.ends) });
  return (
    <li className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div
        role="group"
        aria-label={t('breakGroup', { weekday, times, label: each.label })}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      >
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="font-medium">{t('breakSummary', { weekday, times })}</span>
          <span className="text-muted wrap-anywhere">{each.label}</span>
        </div>
        <StaffForm
          action={removeBreak}
          doneMessage={t('breakRemoved')}
          onDone={onRemoved}
          refusals={{ not_found: t('breakNotFound') }}
          submitLabel={t('breakRemove')}
          pendingLabel={t('breakRemoving')}
          className="justify-items-end"
        >
          <input type="hidden" name="breakId" value={each.id} />
        </StaffForm>
      </div>
    </li>
  );
}

interface TimeLabels {
  /** An ISO weekday, 1 = Monday, as its name. */
  weekday: (weekday: number) => string;
  /** A time's value, `HH:MM`, as the clinic's clock shows it. */
  time: (value: string) => string;
}

/**
 * The names a break is shown with, the formatter's, so the clinic's clock (E01-T04b, D-049) reaches
 * them. A weekday and a time are no moments: formatted in UTC, as the opening hours' are (CLAUDE.md).
 */
function timeLabelsOf(format: ReturnType<typeof useFormatter>): TimeLabels {
  return {
    // 1 January 2024 was a Monday: ISO weekday n is the nth of that month.
    weekday: (weekday) =>
      format.dateTime(new Date(Date.UTC(2024, 0, weekday)), { weekday: 'long', timeZone: 'UTC' }),
    time: (value) => {
      const seconds = Math.round((minutesOfTimeValue(value) ?? 0) * 60);
      return format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, 0, seconds)), {
        hour: 'numeric',
        minute: '2-digit',
        second: seconds % 60 === 0 ? undefined : '2-digit',
        timeZone: 'UTC',
      });
    },
  };
}
