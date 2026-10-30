'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { useDoubleClickGuard } from './double-click-guard';

/**
 * The dialog: shadcn/ui's Dialog (D-009, style new-york-v4), on Radix's. A question that needs a
 * few fields, as when a cancel asks who cancelled and why (E01-T06), not a yes or a no. Radix keeps
 * the focus inside while it is open, closes it on Escape and on a click outside it, and gives the
 * focus back to what opened it.
 */
function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

/**
 * The props of a button that opens or closes the dialog: Radix's, which are a button's, without
 * formAction and formMethod (D-084), so it never sends its form to another URL or as a GET with
 * every field in the URL (D-076, D-081); and without type, which it sets itself.
 */
type DialogTriggerProps = Omit<
  ComponentProps<typeof DialogPrimitive.Trigger>,
  'formAction' | 'formMethod' | 'type'
>;
type DialogCloseProps = Omit<
  ComponentProps<typeof DialogPrimitive.Close>,
  'formAction' | 'formMethod' | 'type'
>;

/**
 * Opens the dialog. Its button is type="button", written after the props: Radix writes its own
 * before them, where a caller's would win, and in a staff form the one submit button is Send. With
 * asChild it lends these to its child, `<DialogTrigger asChild><Button>…</Button></DialogTrigger>`,
 * whose own type would still win (Radix's Slot): Button has none.
 */
function DialogTrigger(props: DialogTriggerProps) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} type="button" />;
}

/** Closes the dialog; type="button" as DialogTrigger's. */
function DialogClose(props: DialogCloseProps) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} type="button" />;
}

type DialogContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & {
  /**
   * The dialog's title, which names it for a screen reader. Required, and never nothing: Radix
   * 1.1.23 names a dialog only when its Title is rendered, and says nothing when it is not.
   */
  title: Exclude<ReactNode, null | undefined | boolean>;
  /** A line under the title, in the muted colour; a screen reader reads it with the dialog. */
  description?: ReactNode;
  /**
   * True while a request of a form inside is on its way (E01-T06e, E01-T05a tester): Escape, a press
   * on the overlay and Close then leave it open, so the form's answer, a refusal too, shows above its
   * button. The caller sets it from its forms' `onSendingChange` and clears it when they have answered.
   */
  busy?: boolean;
};

/**
 * The open dialog. The demo has none: a card's surface, border and radius (no shadow, as a card
 * has none), at shadcn/ui's width of 512 px and on a narrow screen 16 px inside its edges, in the
 * middle of the screen over the drawer's overlay, which closes it on a click. Its title is a
 * card's (16 px, weight 600); the round close button is the drawer's. It enters as the drawer does,
 * a fade and a 6 px rise in 0.2 s, and at once when the system asks for less motion.
 *
 * The close button comes after the children in the page's order, placed in the corner as
 * shadcn/ui's is: Radix gives the first focus to the first control inside. Its label comes from the
 * message file. The dialog sits on the drawer's level, opened after it and so above it, under the
 * toast (sheet.tsx).
 *
 * A double click on what opens it leaves it open, as the drawer's does (E01-T05a,
 * ./double-click-guard.ts): for half a second after it opens, a pointer down outside it is ignored,
 * and so is a press of the close button by a pointer. Escape, and a key on the close button, always
 * close it. And the double click's second press changes nothing in it, as in the drawer (E01-T05c):
 * for that half second a pointer's press in it or on the overlay moves no focus and reaches no
 * control; a key always works.
 *
 * Two guards for the forms inside, as the drawer's (E01-T06e, ./sheet.tsx): while `busy` is set it
 * stays open on Escape, the overlay and Close; and a `submit` from a form inside goes no further than
 * its content, so a dialog opened from inside a form never sends that form.
 */
function DialogContent({
  title,
  description,
  className,
  children,
  busy = false,
  onOpenAutoFocus,
  onEscapeKeyDown,
  onInteractOutside,
  onPointerDownOutside,
  onPointerDownCapture,
  onMouseDownCapture,
  onClickCapture,
  onKeyDownCapture,
  onSubmit,
  ...props
}: DialogContentProps) {
  const t = useTranslations('dialog');
  const guard = useDoubleClickGuard({
    onOpenAutoFocus,
    onPointerDownOutside: (event) => {
      onPointerDownOutside?.(event);
      if (busy) event.preventDefault();
    },
    onPointerDownCapture,
    onMouseDownCapture,
    onClickCapture,
    onKeyDownCapture,
  });
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-40 bg-overlay"
        {...guard.overlay}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed inset-x-4 top-1/2 z-40 mx-auto grid max-w-lg -translate-y-1/2 gap-4 rounded-card border border-border bg-surface p-6 text-text outline-none motion-safe:animate-drawer',
          className,
        )}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (busy) event.preventDefault();
        }}
        onSubmit={(event) => {
          onSubmit?.(event);
          // React passes a `submit` on to every onSubmit above, through a portal too: a form in here
          // sends itself only, never a form that holds this dialog's opener (E00-T04e review).
          event.stopPropagation();
        }}
        {...props}
        {...guard.content}
      >
        <div data-slot="dialog-header" className="grid gap-1.5 pr-8">
          <DialogPrimitive.Title
            data-slot="dialog-title"
            className="text-section leading-snug font-semibold"
          >
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description data-slot="dialog-description" className="text-muted">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        {children}
        <DialogClose
          {...guard.close}
          onClick={(event) => {
            guard.close.onClick(event);
            if (busy) event.preventDefault();
          }}
          className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-pill bg-border/50 text-text transition-colors outline-none hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <XIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">{t('close')}</span>
        </DialogClose>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** The dialog's buttons, in a row at its right. */
function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-wrap justify-end gap-2', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  type DialogCloseProps,
  type DialogContentProps,
  type DialogTriggerProps,
};
