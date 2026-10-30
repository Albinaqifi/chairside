'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { StaffField, StaffForm } from '@/app/_lib/staff-form';
import { DialogContent } from '@/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/ui/native-select';
import { Textarea } from '@/ui/textarea';
import { changeAppointmentStatus } from './appointment-actions';
import { CANCEL_REASON_LIMIT } from './cancel-reason';

/** Who cancelled, in the order the select lists them: the action's `cancelledBy` values. */
const WHO = ['patient', 'staff'] as const;

/**
 * The cancel dialog's content (E01-T06e), over the appointment drawer: a StaffForm of its own that
 * asks who cancelled and, if the person wants, why, and sends the cancel. The drawer renders it inside
 * the `Dialog` its Cancel button opens; the form exists only while the dialog is open, so each opening
 * starts empty.
 *
 * Who cancelled has no choice made at first: a wrong default is a wrong record, which a later message
 * depends on (D-123). Sent with nothing chosen, the form's "Fill this in." shows at the field and
 * nothing is written. The select is the browser's own (NativeSelect): the double click's guard stops a
 * press on it within half a second of the dialog opening, which a Radix select would not honour. The
 * reason is optional, at most CANCEL_REASON_LIMIT characters; the action keeps it in the row and in no
 * audit row. The dialog stays open while the request is on its way (`busy`), so an answer, a refusal
 * too, shows above the button; `onDone` closes it. Cancelling is its only send.
 */
export function CancelDialogContent({
  appointmentId,
  onDone,
  onCloseAutoFocus,
}: {
  appointmentId: string;
  /** After the toast: the drawer closes the dialog. */
  onDone: () => void;
  /** Where the focus goes when the dialog closes: the drawer says. */
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations('calendar.appointment');
  const [sending, setSending] = useState(false);
  return (
    <DialogContent
      title={t('cancelDialog.title')}
      description={t('cancelDialog.description')}
      busy={sending}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <StaffForm
        action={changeAppointmentStatus}
        doneMessage={t('actions.cancel.done')}
        onDone={onDone}
        onSendingChange={setSending}
        refusals={{
          not_allowed: t('refusals.notAllowed'),
          not_found: t('refusals.notFound'),
        }}
        submitLabel={t('cancelDialog.submit')}
        pendingLabel={t('cancelDialog.pending')}
      >
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <input type="hidden" name="action" value="cancel" />
        <StaffField
          name="cancelledBy"
          label={t('cancelDialog.who')}
          render={(field) => (
            <NativeSelect {...field} defaultValue="">
              <NativeSelectOption value="">{t('cancelDialog.choose')}</NativeSelectOption>
              {WHO.map((who) => (
                <NativeSelectOption key={who} value={who}>
                  {t(`cancelDialog.${who}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
        <StaffField
          name="reason"
          label={t('cancelDialog.reason')}
          render={(field) => <Textarea {...field} maxLength={CANCEL_REASON_LIMIT} />}
        />
      </StaffForm>
    </DialogContent>
  );
}
