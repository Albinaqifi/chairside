'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StaffForm } from '@/app/_lib/staff-form';
import type { AppointmentStatus, StatusAction } from '@/modules/scheduling';
import { Badge, type BadgeVariant } from '@/ui/badge';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Dialog, DialogTrigger } from '@/ui/dialog';
import { Sheet, SheetBody, SheetContent, SheetFooter } from '@/ui/sheet';
import { changeAppointmentStatus } from './appointment-actions';
import { CancelDialogContent } from './cancel-dialog';
import type { AppointmentBlock, Column } from './day';

/** The pill's variant for each status: the Badge names the no-show's with a hyphen. */
const PILL: Record<AppointmentStatus, BadgeVariant> = {
  booked: 'booked',
  confirmed: 'confirmed',
  arrived: 'arrived',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no-show',
};

/**
 * The buttons of "Update status", in the order the drawer shows them (E01-T06b, E01-T06e). Restore is
 * not here: it is E01-T06c's, so a visit that can only be restored shows the muted line. Cancel is the
 * one that is no StaffForm of its own: it opens the cancel dialog (./cancel-dialog.tsx).
 */
const SHOWN = [
  'arrive',
  'complete',
  'no_show',
  'confirm',
  'undo_arrival',
  'undo_completion',
  'cancel',
] as const satisfies readonly StatusAction[];
type Shown = (typeof SHOWN)[number];
/** The buttons that are a status form of their own. */
type FormAction = Exclude<Shown, 'cancel'>;

/**
 * How long the status buttons take no click from a pointer once the buttons have changed (E01-T06b
 * test finding 1, as the closed days' list, E01-T08c). A change redraws the buttons: "In the chair"
 * is gone and "Done" stands in its cell, under a pointer that rests there. A person's double click
 * sends its second press up to half a second after the first (Windows' default; its slowest setting
 * is 0.9 s), and the first one's answer can be back before it, so the second would complete the
 * visit. The moment starts when the buttons change, so it covers a second press however fast the
 * answer came.
 */
const SETTLE_MS = 1_000;

/** The close of the drawer puts the focus back on the block that opened it, if it is still there. */
function focusBlock(appointmentId: string) {
  const blocks = document.querySelectorAll<HTMLElement>('[data-appointment]');
  for (const found of blocks) {
    if (found.dataset['appointment'] === appointmentId) {
      found.focus();
      return;
    }
  }
}

/**
 * The appointment drawer (E01-T06b, demo lines 1197–1258): the patient's name as the title, under it
 * the treatment, the status pill, the day and time in the clinic's zone (24-hour, next-intl's
 * formatter), the provider and chair, "Update status" with a button for each action the visit allows
 * (`block.actions`, which the module computed from the state machine: the browser never works them
 * out), and at the foot a link to the patient's profile. The profile link never prefetches: opening
 * the profile is a recorded view (E01-T03a), and a prefetch would write one nobody opened.
 *
 * It opens from the calendar's state, the opened visit's id, and shows the visit as the day the
 * calendar holds now has it, so a read on use or a change's own answer updates the pill and the
 * buttons at once; a visit that the day no longer holds closes it (./calendar-screen.tsx). It stays
 * open after a change. Each button is a StaffForm of its own with the appointment and the action
 * hidden (as Settings' Make inactive is), so a double click sends one request and a refusal shows
 * above its button. For a moment (SETTLE_MS) after the buttons change, the grid takes no pointer
 * press: the buttons move under a resting pointer. On close the focus goes back to the visit's
 * block: Radix does that for its own trigger only, and a drawer opened from state has none (WebKit
 * and Firefox on a Mac do not focus a clicked button, so nothing else would hold it).
 *
 * Cancel (E01-T06e) opens a dialog over the drawer, which asks who cancelled and why. When the cancel
 * is done the visit has no Cancel button any more, so the dialog's return target is gone with it: the
 * focus goes to the drawer itself, and a dialog closed any other way gives it back to Cancel. While a
 * request of any of the drawer's forms is on its way (the forms tell, `onSendingChange`), Escape, the
 * overlay and Close leave it open, so a refusal always shows above its button.
 *
 * Not here yet: moving and restoring (E01-T06c), Book next visit (E01-T06d), the visit's messages,
 * the aftercare box and the treatment plan (later milestones).
 */
export function AppointmentDrawer({
  block,
  column,
  year,
  onClose,
}: {
  block: AppointmentBlock;
  /** The provider's column the visit is in: its name and chair. */
  column: Column;
  /** Whether the day's year is shown: it is when the day is not in the clinic's current year. */
  year: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  // How many of the drawer's status forms are sending: any keeps it open. A form that leaves the page
  // while it sends tells false as it goes (StaffForm), so the count always comes back to zero.
  const [sending, setSending] = useState(0);
  const track = useCallback((on: boolean) => setSending((count) => count + (on ? 1 : -1)), []);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Where the focus goes when the cancel dialog closes (see the comment above the component).
  const content = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  const actions = SHOWN.filter((action: Shown) => block.actions.includes(action));
  // The buttons as last rendered, compared while rendering: the commit that changes them is the one
  // that stops their clicks, so no frame shows them changed and taking a press. Only the pointer's:
  // a key, and assistive technology, act on the control they name, which no redraw changes under it.
  const offered = actions.join();
  const [rendered, setRendered] = useState(offered);
  const [settling, setSettling] = useState(false);
  if (rendered !== offered) {
    setRendered(offered);
    setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    // A later change of the buttons (offered) starts the moment again.
    const timer = setTimeout(() => setSettling(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [settling, offered]);
  const startsAt = new Date(block.startsAt);
  const day = format.dateTime(startsAt, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: year ? 'numeric' : undefined,
  });
  const time = { hour: 'numeric', minute: '2-digit' } as const;
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        ref={content}
        busy={sending > 0}
        title={t('patients.fullName', {
          first: block.patient.firstName,
          last: block.patient.lastName,
        })}
        description={block.title}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusBlock(block.id);
        }}
      >
        <SheetBody>
          <Dialog
            open={cancelOpen}
            onOpenChange={(open) => {
              if (open) cancelled.current = false;
              setCancelOpen(open);
            }}
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <Badge variant={PILL[block.status]}>{t(`appointmentStatus.${block.status}`)}</Badge>
              <span>
                {t('calendar.appointment.when', {
                  day,
                  from: format.dateTime(startsAt, time),
                  to: format.dateTime(new Date(block.endsAt), time),
                })}
              </span>
            </div>
            <p className="-mt-2 text-muted">
              {t('calendar.appointment.where', { provider: column.name, chair: column.chairLabel })}
            </p>
            {actions.length > 0 ? (
              <section aria-labelledby="appointment-update-status">
                <h3 id="appointment-update-status" className="mb-2 text-small font-semibold">
                  {t('calendar.appointment.update')}
                </h3>
                <div className={cn('grid grid-cols-2 gap-2', settling && 'pointer-events-none')}>
                  {actions.map((action) =>
                    action === 'cancel' ? (
                      <DialogTrigger key={`${block.id}-cancel`} asChild>
                        <Button ref={cancelButton} variant="secondary" className="w-full">
                          {t('calendar.appointment.actions.cancel.label')}
                        </Button>
                      </DialogTrigger>
                    ) : (
                      <StatusButton
                        key={`${block.id}-${action}`}
                        block={block}
                        action={action}
                        onSendingChange={track}
                      />
                    ),
                  )}
                </div>
              </section>
            ) : (
              <p className="text-muted">{t('calendar.appointment.nothingToChange')}</p>
            )}
            <CancelDialogContent
              appointmentId={block.id}
              onDone={() => {
                cancelled.current = true;
                setCancelOpen(false);
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const back = !cancelled.current && cancelButton.current?.isConnected;
                (back ? cancelButton.current : content.current)?.focus();
              }}
            />
          </Dialog>
        </SheetBody>
        <SheetFooter>
          <Button asChild variant="secondary" className="flex-1">
            <Link href={`/patients/${block.patientId}`} prefetch={false}>
              {t('calendar.appointment.profile')}
            </Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * One status change: a StaffForm of its own, the visit and the action hidden. Its three refusals have
 * a text above the button (the visit changed meanwhile, a no-show before the start, no such visit); any
 * other refusal shows the form's general failure. Keyed by the visit and the action, so an answer is
 * not carried to another visit or action.
 */
function StatusButton({
  block,
  action,
  onSendingChange,
}: {
  block: AppointmentBlock;
  action: FormAction;
  onSendingChange: (sending: boolean) => void;
}) {
  const t = useTranslations('calendar.appointment');
  return (
    <StaffForm
      action={changeAppointmentStatus}
      doneMessage={t(`actions.${action}.done`)}
      refusals={{
        not_allowed: t('refusals.notAllowed'),
        too_early: t('refusals.tooEarly'),
        not_found: t('refusals.notFound'),
      }}
      submitLabel={t(`actions.${action}.label`)}
      pendingLabel={t('updating')}
      onSendingChange={onSendingChange}
      className="[&_button]:w-full"
    >
      <input type="hidden" name="appointmentId" value={block.id} />
      <input type="hidden" name="action" value={action} />
    </StaffForm>
  );
}
