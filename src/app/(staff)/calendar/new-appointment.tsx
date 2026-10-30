'use client';

import { useFormatter, useTimeZone, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import { newId } from '@/lib/ids';
import type { TreatmentType } from '@/modules/scheduling';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { withinDoubleClick } from '@/ui/double-click-guard';
import type { FieldControlProps } from '@/ui/field';
import { Input } from '@/ui/input';
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
  type Slot,
} from './booking-choices';
import { anyWarning, bookingWarnings, NO_WARNINGS, type BookingWarnings } from './booking-warnings';
import type { CalendarDayView } from './day';
import { newPatientFrom, unreachable } from './new-patient';
import { PatientField, type PickedPatient } from './patient-field';

/** A time of the day the drawer shows, "10:30": no moment, so in UTC, as the grid's hours are. */
const TIME_OF_DAY = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } as const;

/** A visit's time, "09:00": a moment, so in the clinic's zone (next-intl's), as the grid shows it. */
const VISIT_TIME = { hour: 'numeric', minute: '2-digit' } as const;

/** A treatment's chip (demo line 1344), as the calendar's provider chips are drawn. */
const CHIP =
  'rounded-pill border px-2.5 py-1.5 text-small outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid';

/**
 * New appointment (E01-T05a, demo lines 237, 1323–1362): the button in the calendar's header, and the
 * drawer it opens at once, from this component's state, never a navigation (a read on use on its way
 * would hold one). What the drawer offers (./booking-choices.ts) is read when it opens, from the day
 * the calendar shows, the columns shown and the browser's clock in the clinic's zone, and kept while it
 * is open: a read on use that brings a new day under it changes nothing typed or chosen in it (D-108).
 * Each opening starts a new booking. What the drawer warns of (E01-T05b) is read from the day the
 * calendar holds now, `view`, handed on as a prop that changes, never as a key.
 *
 * After a booking the drawer closes, the toast names the patient and the time, and `onBooked` gets
 * the provider, whose column the calendar turns on (demo logic lines 2133–2134). The booking's
 * answer brings the calendar's day again (refresh()), so the block is on the grid at once.
 *
 * A click on an empty slot of the grid opens the same drawer at once (E01-T05c, `ref`'s `openAt`),
 * its choices read as New appointment's are, with the slot's start and provider in place of the first
 * ones. Not within a double click of the drawer closing: a double click on Book whose answer closes
 * the drawer before the second click lands that click on the grid, which then opens nothing.
 */
export function NewAppointment({
  view,
  treatmentTypes,
  shown,
  onBooked,
  ref,
}: {
  view: CalendarDayView;
  treatmentTypes: readonly TreatmentType[];
  /** The ids of the columns shown, in order: the first active one is the provider first chosen. */
  shown: readonly string[];
  onBooked: (providerId: string) => void;
  /** Where the calendar's grid opens the drawer on a slot (./calendar-screen.tsx). */
  ref?: Ref<NewAppointmentHandle>;
}) {
  const t = useTranslations('calendar.booking');
  const timeZone = useTimeZone();
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<{ count: number; choices: BookingChoices } | null>(null);

  // When the drawer last went from the page: only from then does a click land on the grid under it.
  // Taken as the render removes it, since a booking's answer closes it with no event of its own; on
  // the clock an event's time stamp counts on, performance.now(), so a click's compares with it.
  const closedAt = useRef<number | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current && !open) closedAt.current = performance.now();
    wasOpen.current = open;
  }, [open]);

  function openOn(slot: Slot | null) {
    // The browser's clock, in the clinic's zone, as the "now" line reads it. Every request names
    // the clinic's zone (src/i18n/request.ts); without one, the day's opening.
    const now = timeZone === undefined ? null : clinicNow(new Date(), timeZone);
    const choices = bookingChoices(view, treatmentTypes, shown, now, slot);
    setOpening((before) => ({ count: (before?.count ?? 0) + 1, choices }));
    setOpen(true);
  }

  function openChange(next: boolean) {
    if (next) openOn(null);
    else setOpen(false);
  }

  useImperativeHandle(ref, () => ({
    openAt(slot: Slot, at: number) {
      if (open || withinDoubleClick(closedAt.current, at)) return;
      openOn(slot);
    },
  }));

  return (
    <Sheet open={open} onOpenChange={openChange}>
      <SheetTrigger asChild>
        <Button>{t('open')}</Button>
      </SheetTrigger>
      {opening && (
        <BookingDrawer
          key={opening.count}
          choices={opening.choices}
          view={view}
          onBooked={(providerId) => {
            setOpen(false);
            onBooked(providerId);
          }}
        />
      )}
    </Sheet>
  );
}

/** What the calendar's grid can ask of New appointment (E01-T05c). */
export interface NewAppointmentHandle {
  /**
   * Opens the drawer on an empty slot, clicked at `at` (the click's time stamp): unless it is open
   * already, or the click comes within a double click of the drawer closing.
   */
  openAt: (slot: Slot, at: number) => void;
}

/**
 * A new patient being booked (E01-T05d): their fields as typed, and the search's text they started
 * from, which "Back to the search" puts back.
 */
export interface NewPatientDraft {
  typed: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

/** What the person has chosen so far. */
export interface Booking {
  patient: PickedPatient | null;
  /** The new patient's fields, shown in place of the search; null while the search shows. */
  newPatient: NewPatientDraft | null;
  /** What the search starts with: back from a new patient, the text typed before (E01-T05d). */
  searchText: string;
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
  view,
  onBooked,
}: {
  choices: BookingChoices;
  /** The day the calendar holds now: each read on use and each booking's answer change it. */
  view: CalendarDayView;
  onBooked: (providerId: string) => void;
}) {
  const t = useTranslations('calendar.booking');
  const format = useFormatter();
  // The new patient's id, made once per opening (this component is keyed by it) and sent with a new
  // patient, so the same booking sent twice adds them once (E01-T05d, test-strategy.md Duplicates).
  const [newPatientId] = useState(newId);
  const [booking, setBooking] = useState<Booking>({
    patient: null,
    newPatient: null,
    searchText: '',
    treatmentId: null,
    start: choices.firstStart,
    length: FIRST_LENGTH,
    providerId: choices.firstProviderId ?? '',
  });
  const [listOpen, setListOpen] = useState(false);
  // While Book is on its way the drawer stays open on Escape, the overlay and Close, so a refusal
  // shows above Book (E01-T06e, E01-T05a tester).
  const [sending, setSending] = useState(false);
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
      busy={sending}
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
          view={view}
          booking={booking}
          newPatientId={newPatientId}
          onChange={(change) => setBooking((before) => ({ ...before, ...change }))}
          listOpen={listOpen}
          onListOpen={setListOpen}
          onDone={onBooked}
          onSendingChange={setSending}
        />
      </SheetBody>
    </SheetContent>
  );
}

/**
 * The booking's form (demo lines 1328–1360): a StaffForm, sending the frame's clinic (D-092), that
 * keeps nothing in the browser (D-093, D-095): no field sets an `autocomplete` of its own. The
 * patient, picked from the search, or a new one's fields in its place (E01-T05d); the treatment's
 * chips, none pressed until one is picked, each setting the length to its own; the start, the length and the provider, each the browser's own
 * select; the day the calendar shows, hidden. Book names the time and the provider (demo logic
 * line 2127). A problem of the input shows at its field; the clinic's refusals above Book (D-098).
 *
 * Above Book, what the time is warned of on the day the calendar holds now (./booking-warnings.ts,
 * E01-T05b), following start, length and provider as they change: an overlap turns Book into Book
 * anyway and adds the hidden `anyway`, sent only while the overlap shows (D-020); a break, the hours
 * or a closed day leave Book as it is. Past midnight a page on the clinic's today reads the next day,
 * whose visits are not this booking's: then nothing is warned of, and the server's check still
 * refuses an overlap.
 */
export function BookingForm({
  choices,
  view,
  booking,
  newPatientId,
  onChange,
  listOpen,
  onListOpen,
  onDone,
  onSendingChange,
}: {
  choices: BookingChoices;
  /** The day the calendar holds now. */
  view: CalendarDayView;
  booking: Booking;
  /** The id a new patient is added under: the drawer's, one per opening (E01-T05d). */
  newPatientId: string;
  onChange: (change: Partial<Booking>) => void;
  listOpen: boolean;
  onListOpen: (open: boolean) => void;
  /** After the toast, with the booked appointment's provider. */
  onDone: (providerId: string) => void;
  /** Told when Book is on its way and when it has answered: the drawer stays open meanwhile. */
  onSendingChange?: (sending: boolean) => void;
}) {
  const t = useTranslations('calendar.booking');
  const names = useTranslations('patients');
  const format = useFormatter();
  const treatmentLabel = useId();
  const time = (minutes: number) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minutes)), TIME_OF_DAY);
  const treatment = choices.treatmentTypes.find((type) => type.id === booking.treatmentId) ?? null;
  const provider = choices.providers.find((found) => found.id === booking.providerId) ?? null;
  // The toast names the patient: the one picked, or the new one by the names typed.
  const named = booking.newPatient ?? booking.patient;
  const patientName = named
    ? names('fullName', { first: named.firstName.trim(), last: named.lastName.trim() })
    : '';
  const warnings = view.day === choices.day ? bookingWarnings(view, booking) : NO_WARNINGS;
  const anyway = warnings.overlaps.length > 0;
  return (
    <StaffForm
      action={bookAppointment}
      doneMessage={t('booked', { name: patientName, time: time(booking.start) })}
      onDone={(value) => onDone(value.providerId)}
      refusals={{
        overlap: t('overlap'),
        already_booked: t('alreadyBooked'),
        patient_not_bookable: t('patientNotBookable'),
        provider_not_bookable: t('providerNotBookable'),
        treatment_not_bookable: t('treatmentNotBookable'),
        start_skipped: t('startSkipped'),
        phone_impossible: t('phoneImpossible'),
        new_patient_forbidden: t('newPatientForbidden'),
      }}
      submitLabel={
        provider
          ? t(anyway ? 'bookAnyway' : 'book', {
              time: time(booking.start),
              provider: provider.shortName,
            })
          : t('bookWithoutProvider', { time: time(booking.start) })
      }
      pendingLabel={t('booking')}
      onSendingChange={onSendingChange}
    >
      <input type="hidden" name="day" value={choices.day} />
      {anyway && <input type="hidden" name="anyway" value="true" />}
      {booking.newPatient ? (
        <NewPatientFields
          id={newPatientId}
          draft={booking.newPatient}
          onChange={(change) =>
            booking.newPatient && onChange({ newPatient: { ...booking.newPatient, ...change } })
          }
          onBack={(typed) => onChange({ newPatient: null, searchText: typed })}
        />
      ) : (
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
              initialText={booking.searchText}
              onNewPatient={(typed) =>
                onChange({
                  patient: null,
                  newPatient: { typed, email: '', ...newPatientFrom(typed) },
                })
              }
            />
          )}
        />
      )}
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
      {/*
        The form's last child: StaffForm puts its refusal's message and Book right under it. The
        warning shares it with the selects, so its live region, empty, adds no gap above Book.
      */}
      <div>
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
        <BookingWarning
          warnings={warnings}
          day={choices.day}
          providerName={provider?.shortName ?? ''}
        />
      </div>
    </StaffForm>
  );
}

/**
 * What the drawer warns of, above Book (E01-T05b), a line each: each visit the time overlaps, its
 * patient and its time, as the grid shows them (demo line 1350, logic line 2125), then that Book
 * anyway still books it; the provider's break; the day's opening hours, when the time runs outside
 * them; the day the clinic is closed (owner, D-114). A polite live region that is always there, as the
 * new patient's duplicate warning is, so a screen reader reads a warning when it appears; empty, it
 * takes no room.
 */
function BookingWarning({
  warnings,
  day,
  providerName,
}: {
  warnings: BookingWarnings;
  /** The booking's day, for a weekday without hours. */
  day: string;
  providerName: string;
}) {
  const t = useTranslations('calendar.booking.warning');
  const names = useTranslations('patients');
  const format = useFormatter();
  const time = (minutes: number) =>
    format.dateTime(new Date(Date.UTC(2000, 0, 1, 0, minutes)), TIME_OF_DAY);
  const lines: { key: string; text: string }[] = [
    ...warnings.overlaps.map((visit) => ({
      key: visit.id,
      text: t('overlap', {
        name: names('fullName', { first: visit.patient.firstName, last: visit.patient.lastName }),
        from: format.dateTime(new Date(visit.startsAt), VISIT_TIME),
        to: format.dateTime(new Date(visit.endsAt), VISIT_TIME),
      }),
    })),
    ...warnings.breaks.map((found) => ({
      key: found.id,
      text: t('break', {
        provider: providerName,
        label: found.label,
        from: time(found.from),
        to: time(found.to),
      }),
    })),
  ];
  if (warnings.outsideHours) {
    lines.push({
      key: 'hours',
      text: t('outsideHours', {
        from: time(warnings.outsideHours.from),
        to: time(warnings.outsideHours.to),
      }),
    });
  }
  if (warnings.closed) {
    lines.push({
      key: 'closed',
      text:
        warnings.closed.why === 'closed_day'
          ? t('closedDay', { label: warnings.closed.label })
          : t('noHours', {
              weekday: format.dateTime(new Date(day), { weekday: 'long', timeZone: 'UTC' }),
            }),
    });
  }
  return (
    <div role="status">
      {anyWarning(warnings) && (
        <div className="mt-4 grid gap-1 rounded-control border border-warn-border bg-warn-bg px-3 py-2">
          <ul className="grid gap-1">
            {lines.map((line) => (
              <li key={line.key}>{line.text}</li>
            ))}
          </ul>
          {warnings.overlaps.length > 0 && <p>{t('anyway')}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The new patient's fields (E01-T05d; scope-v1.md, quick add), in place of the patient search: first
 * name, last name, phone and email, fields of the booking's form, not a form of their own (D-113),
 * which come filled from the words typed (./new-patient.ts), the focus in the first one. Each is
 * checked as the new-patient page's is, a problem shown at its field; an impossible phone is the
 * handler's refusal, above Book (D-098). No field sets an `autocomplete` of its own: the booking's
 * StaffForm keeps nothing in the browser (D-093, D-095), and their words go in the booking's request
 * body. Without a phone and an email, a line under them says no reminder can reach the patient, and
 * Book still books. "Back to the search" (a button that sends nothing) shows the search again with
 * the text typed. The hidden `newPatientId` is the drawer's id for them.
 */
function NewPatientFields({
  id,
  draft,
  onChange,
  onBack,
}: {
  id: string;
  draft: NewPatientDraft;
  onChange: (change: Partial<NewPatientDraft>) => void;
  onBack: (typed: string) => void;
}) {
  const t = useTranslations('calendar.booking');
  const fields = useTranslations('newPatient');
  const first = useRef<HTMLInputElement>(null);
  const legend = useId();
  // The focus in the first field as they show: the search that had it is gone.
  useEffect(() => {
    first.current?.focus();
  }, []);
  return (
    <div role="group" aria-labelledby={legend} className="grid gap-3">
      <p id={legend} className="font-medium">
        {t('newPatient')}
      </p>
      <input type="hidden" name="newPatientId" value={id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <StaffField
          name="firstName"
          label={fields('firstName')}
          render={(field) => (
            <Input
              {...field}
              ref={first}
              value={draft.firstName}
              onChange={(event) => onChange({ firstName: event.currentTarget.value })}
            />
          )}
        />
        <StaffField
          name="lastName"
          label={fields('lastName')}
          render={(field) => (
            <Input
              {...field}
              value={draft.lastName}
              onChange={(event) => onChange({ lastName: event.currentTarget.value })}
            />
          )}
        />
        <StaffField
          name="phone"
          label={fields('phone')}
          render={(field) => (
            <Input
              {...field}
              type="tel"
              value={draft.phone}
              onChange={(event) => onChange({ phone: event.currentTarget.value })}
            />
          )}
        />
        <StaffField
          name="email"
          label={fields('email')}
          render={(field) => (
            <Input
              {...field}
              type="email"
              value={draft.email}
              onChange={(event) => onChange({ email: event.currentTarget.value })}
            />
          )}
        />
      </div>
      {/* Always there, so a screen reader reads the line when it appears. */}
      <div role="status">
        {unreachable(draft.phone, draft.email) && (
          <p className="rounded-control border border-warn-border bg-warn-bg px-3 py-2">
            {t('unreachable')}
          </p>
        )}
      </div>
      <div>
        <Button type="button" variant="secondary" onClick={() => onBack(draft.typed)}>
          {t('backToSearch')}
        </Button>
      </div>
    </div>
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
