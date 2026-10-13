'use client';

import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import type { TreatmentType } from '@/modules/scheduling';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import type { FieldControlProps } from '@/ui/field';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Sheet, SheetBody, SheetContent, SheetTrigger } from '@/ui/sheet';
import { bookAppointment } from './actions';
import {
  bookingChoices,
  clinicNow,
  FIRST_LENGTH,
  lengthChoices,
  minutesOfStart,
  startValue,
  type BookingChoices,
} from './booking-choices';
import type { CalendarDayView } from './day';
import { PatientField, type PickedPatient } from './patient-field';

/** A time of the day the drawer shows, "10:30": no moment, so in UTC, as the grid's hours are. */
const TIME_OF_DAY = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } as const;

/** A treatment's chip (demo line 1344), as the calendar's provider chips are drawn. */
const CHIP =
  'rounded-pill border px-2.5 py-1.5 text-small outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid';

/**
 * New appointment (E01-T05a, demo lines 237, 1323–1362): the button in the calendar's header, and the
 * drawer it opens at once, from this component's state, never a navigation (a read on use on its way
 * would hold one). What the drawer offers (./booking-choices.ts) is read when it opens, from the day
 * the calendar shows, the columns shown and the browser's clock in the clinic's zone, and kept while it
 * is open: a read on use that brings a new day under it changes nothing typed or chosen in it (D-108).
 * Each opening starts a new booking.
 *
 * After a booking the drawer closes, the toast names the patient and the time, and `onBooked` gets
 * the provider, whose column the calendar turns on (demo logic lines 2133–2134). The booking's
 * answer brings the calendar's day again (refresh()), so the block is on the grid at once.
 */
export function NewAppointment({
  view,
  treatmentTypes,
  shown,
  onBooked,
}: {
  view: CalendarDayView;
  treatmentTypes: readonly TreatmentType[];
  /** The ids of the columns shown, in order: the first active one is the provider first chosen. */
  shown: readonly string[];
  onBooked: (providerId: string) => void;
}) {
  const t = useTranslations('calendar.booking');
  const timeZone = useTimeZone();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<{ count: number; choices: BookingChoices } | null>(null);

  function openChange(next: boolean) {
    if (next) {
      // The browser's clock, in the clinic's zone, as the "now" line reads it. Every request names
      // the clinic's zone (src/i18n/request.ts); without one, the day's opening.
      const now = timeZone === undefined ? null : clinicNow(new Date(), timeZone);
      const choices = bookingChoices(view, treatmentTypes, shown, now);
      setOpening((before) => ({ count: (before?.count ?? 0) + 1, choices }));
    }
    setOpen(next);
  }

  return (
    <Sheet open={open} onOpenChange={openChange}>
      <SheetTrigger asChild>
        <Button>{t('open')}</Button>
      </SheetTrigger>
      {opening && (
        <BookingDrawer
          key={opening.count}
          choices={opening.choices}
          onBooked={(providerId) => {
            setOpen(false);
            onBooked(providerId);
          }}
        />
      )}
    </Sheet>
  );
}

/** What the person has chosen so far. */
export interface Booking {
  patient: PickedPatient | null;
  /** None until one is picked: no booking takes a treatment by default (scope-v1.md). */
  treatmentId: string | null;
  /** Minutes from the day's local midnight. */
  start: number;
  /** In minutes. */
  length: number;
  /** '' when the clinic has no active provider. */
  providerId: string;
}

/**
 * The open drawer: its title, under it the day and the time chosen ("Monday, October 12 ·
 * 10:30–11:00"), and the form. Escape closes the patient field's list first, then the drawer.
 */
export function BookingDrawer({
  choices,
  onBooked,
}: {
  choices: BookingChoices;
  onBooked: (providerId: string) => void;
}) {
  const t = useTranslations('calendar.booking');
  const format = useFormatter();
  const [booking, setBooking] = useState<Booking>({
    patient: null,
    treatmentId: null,
    start: choices.firstStart,
    length: FIRST_LENGTH,
    providerId: choices.firstProviderId ?? '',
  });
  const [listOpen, setListOpen] = useState(false);
  const time = (minutes: number) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minutes)), TIME_OF_DAY);
  const day = format.dateTime(new Date(choices.day), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: choices.day.slice(0, 4) === choices.today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  return (
    <SheetContent
      title={t('title')}
      description={t('when', {
        day,
        from: time(booking.start),
        to: time(booking.start + booking.length),
      })}
      onEscapeKeyDown={(event) => {
        if (!listOpen) return;
        event.preventDefault();
        setListOpen(false);
      }}
    >
      <SheetBody>
        <BookingForm
          choices={choices}
          booking={booking}
          onChange={(change) => setBooking((before) => ({ ...before, ...change }))}
          listOpen={listOpen}
          onListOpen={setListOpen}
          onDone={onBooked}
        />
      </SheetBody>
    </SheetContent>
  );
}

/**
 * The booking's form (demo lines 1328–1360): a StaffForm, sending the frame's clinic (D-092), that
 * keeps nothing in the browser (D-093, D-095): no field sets an `autocomplete` of its own. The
 * patient, picked from the search; the treatment's chips, none pressed until one is picked, each
 * setting the length to its own; the start, the length and the provider, each the browser's own
 * select; the day the calendar shows, hidden. Book names the time and the provider (demo logic
 * line 2127). A problem of the input shows at its field; the clinic's refusals above Book (D-098).
 */
export function BookingForm({
  choices,
  booking,
  onChange,
  listOpen,
  onListOpen,
  onDone,
}: {
  choices: BookingChoices;
  booking: Booking;
  onChange: (change: Partial<Booking>) => void;
  listOpen: boolean;
  onListOpen: (open: boolean) => void;
  /** After the toast, with the booked appointment's provider. */
  onDone: (providerId: string) => void;
}) {
  const t = useTranslations('calendar.booking');
  const names = useTranslations('patients');
  const format = useFormatter();
  const treatmentLabel = useId();
  const time = (minutes: number) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minutes)), TIME_OF_DAY);
  const treatment = choices.treatmentTypes.find((type) => type.id === booking.treatmentId) ?? null;
  const provider = choices.providers.find((found) => found.id === booking.providerId) ?? null;
  const patientName = booking.patient
    ? names('fullName', { first: booking.patient.firstName, last: booking.patient.lastName })
    : '';
  return (
    <StaffForm
      action={bookAppointment}
      doneMessage={t('booked', { name: patientName, time: time(booking.start) })}
      onDone={(value) => onDone(value.providerId)}
      refusals={{
        overlap: t('overlap'),
        patient_not_bookable: t('patientNotBookable'),
        provider_not_bookable: t('providerNotBookable'),
        treatment_not_bookable: t('treatmentNotBookable'),
        start_skipped: t('startSkipped'),
      }}
      submitLabel={
        provider
          ? t('book', { time: time(booking.start), provider: provider.shortName })
          : t('bookWithoutProvider', { time: time(booking.start) })
      }
      pendingLabel={t('booking')}
    >
      <input type="hidden" name="day" value={choices.day} />
      <StaffField
        name="patientId"
        label={t('patient')}
        render={(field) => (
          <PatientField
            field={field}
            picked={booking.patient}
            onPick={(patient) => onChange({ patient })}
            listOpen={listOpen}
            onListOpen={onListOpen}
          />
        )}
      />
      <StaffField
        name="treatmentTypeId"
        label={<span id={treatmentLabel}>{t('treatment')}</span>}
        render={(field) => (
          <TreatmentChips
            field={field}
            labelId={treatmentLabel}
            types={choices.treatmentTypes}
            chosen={booking.treatmentId}
            onChoose={(type) => onChange({ treatmentId: type.id, length: type.minutes })}
          />
        )}
      />
      {/* The provider's short name is the longest of the three: its select is the widest. */}
      <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2.5">
        <StaffField
          name="start"
          label={t('start')}
          render={(field) => (
            <NativeSelect
              {...field}
              value={startValue(booking.start)}
              onChange={(event) => {
                const start = minutesOfStart(event.currentTarget.value);
                if (start !== null) onChange({ start });
              }}
            >
              {choices.starts.map((minutes) => (
                <NativeSelectOption key={minutes} value={startValue(minutes)}>
                  {time(minutes)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
        <StaffField
          name="length"
          label={t('length')}
          render={(field) => (
            <NativeSelect
              {...field}
              value={String(booking.length)}
              onChange={(event) => onChange({ length: Number(event.currentTarget.value) })}
            >
              {lengthChoices(treatment?.minutes ?? null, booking.length).map((minutes) => (
                <NativeSelectOption key={minutes} value={String(minutes)}>
                  {t('minutes', { count: minutes })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
        <StaffField
          name="providerId"
          label={t('provider')}
          render={(field) =>
            choices.providers.length === 0 ? (
              // Disabled, so nothing is sent: Book then says the field needs a provider.
              <NativeSelect {...field} disabled defaultValue="">
                <NativeSelectOption value="">{t('noProviders')}</NativeSelectOption>
              </NativeSelect>
            ) : (
              <NativeSelect
                {...field}
                value={booking.providerId}
                onChange={(event) => onChange({ providerId: event.currentTarget.value })}
              >
                {choices.providers.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.shortName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )
          }
        />
      </div>
    </StaffForm>
  );
}

/**
 * The treatment's chips (demo lines 1341–1346): a button for each active treatment type, pressed or
 * not, none pressed until one is picked; the one pressed is the hidden `treatmentTypeId`. Named by the
 * field's label, described by its problem. A clinic without treatment types says so (E01-T09 adds
 * them).
 */
function TreatmentChips({
  field,
  labelId,
  types,
  chosen,
  onChoose,
}: {
  field: FieldControlProps;
  labelId: string;
  types: readonly TreatmentType[];
  chosen: string | null;
  onChoose: (type: TreatmentType) => void;
}): ReactNode {
  const t = useTranslations('calendar.booking');
  if (types.length === 0) {
    return (
      <p id={field.id} className="text-muted">
        {t('noTreatments')}
      </p>
    );
  }
  return (
    <>
      <input type="hidden" name={field.name} value={chosen ?? ''} />
      <div
        id={field.id}
        role="group"
        aria-labelledby={labelId}
        aria-describedby={field['aria-describedby']}
        className="flex flex-wrap gap-1.5"
      >
        {types.map((type) => {
          const on = type.id === chosen;
          return (
            <button
              key={type.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChoose(type)}
              className={cn(
                CHIP,
                on
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border-strong bg-surface text-text hover:bg-border/50',
              )}
            >
              {type.name}
            </button>
          );
        })}
      </div>
    </>
  );
}
