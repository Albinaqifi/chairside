'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { anyWarning, type BookingWarnings } from './booking-warnings';

/** A time of the day the drawers show, "10:30": no moment, so in UTC, as the grid's hours are. */
export const TIME_OF_DAY = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } as const;

/** A visit's time, "09:00": a moment, so in the clinic's zone (next-intl's), as the grid shows it. */
const VISIT_TIME = { hour: 'numeric', minute: '2-digit' } as const;

/**
 * What a drawer warns of, above its button (E01-T05b; moved out of ./new-appointment.tsx for the move
 * form, E01-T06f, and for Restore after it), a line each: each visit the time overlaps, its patient and
 * its time, as the grid shows them (demo line 1350, logic line 2125), then that the "anyway" button
 * still does it (`move`: Move anyway; else Book anyway); the provider's break; the day's opening
 * hours, when the time runs outside them; the day the clinic is closed (owner, D-114). A polite live
 * region that is always there, as the new patient's duplicate warning is, so a screen reader reads a
 * warning when it appears; empty, it takes no room.
 */
export function BookingWarning({
  warnings,
  day,
  providerName,
  move = false,
}: {
  warnings: BookingWarnings;
  /** The day the warnings are of, for a weekday without hours. */
  day: string;
  providerName: string;
  /** The move form's box: its "anyway" line names Move anyway. */
  move?: boolean;
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
          {warnings.overlaps.length > 0 && <p>{t(move ? 'moveAnyway' : 'anyway')}</p>}
        </div>
      )}
    </div>
  );
}
