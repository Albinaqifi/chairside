'use client';

import { useTranslations } from 'next-intl';
import { StaffForm } from '@/app/_lib/staff-form';
import { changeAppointmentStatus } from './appointment-actions';
import { BookingWarning } from './booking-warning';
import { bookingWarnings, NO_WARNINGS } from './booking-warnings';
import type { AppointmentBlock, CalendarDayView, Column } from './day';

/**
 * The appointment drawer's Restore (E01-T06g; the action is E01-T06a's `changeAppointmentStatus`): for
 * a cancelled or no-show visit, a StaffForm of its own with the visit and the action hidden. A restore
 * puts the visit back where it was, so the chair may have been taken since; above the button the
 * booking's own box (./booking-warning.tsx) names each visit of the provider that holds the chair
 * then, from the day the calendar holds (the visit is on it, or the drawer would be closed). Only the
 * overlap lines: a restore chooses no place, so a break, the hours or a closed day would warn of
 * something the desk did not choose. An overlap turns Restore into Restore anyway and adds the hidden
 * `anyway`, sent only while the overlap shows (D-020). The server's check is the one that counts: an
 * overlap another desk made after the box was drawn is refused `overlap`, and the action's refresh
 * brings the day, so the box shows it and the button becomes Restore anyway.
 *
 * Once restored the visit is booked, has other `actions`, and this form is gone with its button: the
 * drawer stays open on it. The press of a double click that lands on the button after the answer is
 * dropped by the drawer's settle (./appointment-drawer.tsx), which covers the grid this form sits in.
 */
export function RestoreForm({
  block,
  column,
  held,
  onSendingChange,
}: {
  block: AppointmentBlock;
  /** The provider's column the visit is in. */
  column: Column;
  /** The day the calendar holds now, which has the visit. */
  held: CalendarDayView;
  onSendingChange: (sending: boolean) => void;
}) {
  const t = useTranslations('calendar.appointment');
  const { overlaps } = bookingWarnings(
    held,
    { providerId: column.providerId, start: block.from, length: block.to - block.from },
    block.id,
  );
  const warnings = { ...NO_WARNINGS, overlaps };
  const anyway = overlaps.length > 0;
  return (
    <StaffForm
      action={changeAppointmentStatus}
      doneMessage={t('restore.done')}
      refusals={{
        overlap: t('restore.refusals.overlap'),
        already_booked: t('restore.refusals.alreadyBooked'),
        provider_not_bookable: t('restore.refusals.providerNotBookable'),
        patient_not_bookable: t('restore.refusals.patientNotBookable'),
        not_allowed: t('refusals.notAllowed'),
        not_found: t('refusals.notFound'),
      }}
      submitLabel={anyway ? t('restore.restoreAnyway') : t('restore.submit')}
      pendingLabel={t('restore.restoring')}
      onSendingChange={onSendingChange}
      className="[&_button]:w-full"
    >
      <input type="hidden" name="appointmentId" value={block.id} />
      <input type="hidden" name="action" value="restore" />
      {anyway && <input type="hidden" name="anyway" value="true" />}
      {/*
        The form's last child: StaffForm puts its refusal's message and the button right under it. The
        box's live region is empty without a warning, so it adds no gap above the button.
      */}
      <BookingWarning
        verb="restore"
        warnings={warnings}
        day={held.day}
        providerName={column.shortName}
      />
    </StaffForm>
  );
}
