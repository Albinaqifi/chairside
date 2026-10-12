'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { FieldControlProps } from '@/ui/field';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Switch } from '@/ui/switch';
import { saveOpeningHours } from './actions';
import {
  hoursFieldNames,
  minutesOfTimeValue,
  timeChoices,
  type WeekdayHoursValues,
} from './opening-hours';

/** A time's label: the formatter's, so the clinic's clock (E01-T04b, D-049) reaches it. */
type TimeLabel = (value: string) => string;

/**
 * The Opening hours tab's form (E01-T08b, demo lines 770–777): each weekday, Monday first, open or
 * closed (a Switch) with its opening and closing time, filled from the clinic's rows; one StaffForm
 * for the week. It sends the frame's clinic (D-092) and keeps nothing in the browser (D-093): no field
 * sets an `autocomplete` of its own. Its page keys it by the clinic (D-098): a render for another
 * clinic starts a form filled with that clinic's hours.
 *
 * Each weekday is keyed by what is stored for it: when a save has changed it, the page renders again
 * (the action's refresh) and that weekday starts again from what is stored now, its switch and its
 * selects; React would keep a select's choice, and the switch's state, while their elements stay.
 */
export function OpeningHoursForm({ week }: { week: WeekdayHoursValues[] }) {
  const t = useTranslations('settings.hours');
  const format = useFormatter();
  // A time is no moment: formatted in UTC, as the calendar's hour labels are (CLAUDE.md).
  const timeLabel: TimeLabel = (value) => {
    const seconds = Math.round((minutesOfTimeValue(value) ?? 0) * 60);
    return format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, 0, seconds)), {
      hour: 'numeric',
      minute: '2-digit',
      second: seconds % 60 === 0 ? undefined : '2-digit',
      timeZone: 'UTC',
    });
  };
  return (
    <StaffForm
      action={saveOpeningHours}
      doneMessage={t('saved')}
      submitLabel={t('save')}
      pendingLabel={t('saving')}
    >
      <p className="text-muted">{t('intro')}</p>
      <div>
        {week.map((day) => (
          <WeekdayRow
            key={`${day.weekday} ${String(day.open)} ${day.opens} ${day.closes}`}
            day={day}
            timeLabel={timeLabel}
          />
        ))}
      </div>
    </StaffForm>
  );
}

/**
 * One weekday: its switch, named by the weekday, then its opening and closing time. While it is
 * closed its selects are disabled, so the browser sends neither: a closed weekday's times are not
 * read (the action's schema).
 */
function WeekdayRow({ day, timeLabel }: { day: WeekdayHoursValues; timeLabel: TimeLabel }) {
  const t = useTranslations('settings.hours');
  const format = useFormatter();
  const [open, setOpen] = useState(day.open);
  const names = hoursFieldNames(day.key);
  // 1 January 2024 was a Monday: ISO weekday n is the nth of that month. No moment: UTC.
  const weekday = format.dateTime(new Date(Date.UTC(2024, 0, day.weekday)), {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return (
    <div
      role="group"
      aria-label={weekday}
      className="grid items-start gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 sm:grid-cols-[10rem_1fr_1fr]"
    >
      {/* sm:pt-7.5: level with the selects, under their labels. */}
      <StaffField
        name={names.open}
        label={weekday}
        orientation="horizontal"
        className="sm:pt-7.5"
        render={(field) => <Switch {...field} checked={open} onCheckedChange={setOpen} />}
      />
      <StaffField
        name={names.opens}
        label={t('opens')}
        render={(field) => (
          <TimeSelect field={field} stored={day.opens} disabled={!open} timeLabel={timeLabel} />
        )}
      />
      <StaffField
        name={names.closes}
        label={t('closes')}
        render={(field) => (
          <TimeSelect field={field} stored={day.closes} disabled={!open} timeLabel={timeLabel} />
        )}
      />
    </div>
  );
}

/**
 * A time: the browser's own select (D-093), the stored time chosen, offered as it is when the steps
 * lack it (./opening-hours.ts). A weekday stored closed has no time: its selects start on "Not set",
 * which an open weekday cannot be saved with.
 */
function TimeSelect({
  field,
  stored,
  disabled,
  timeLabel,
}: {
  field: FieldControlProps;
  stored: string;
  disabled: boolean;
  timeLabel: TimeLabel;
}) {
  const t = useTranslations('settings.hours');
  return (
    <NativeSelect {...field} defaultValue={stored} disabled={disabled}>
      {stored === '' && <NativeSelectOption value="">{t('noTime')}</NativeSelectOption>}
      {timeChoices(stored).map((value) => (
        <NativeSelectOption key={value} value={value}>
          {timeLabel(value)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
