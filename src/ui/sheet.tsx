'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { useDoubleClickGuard } from './double-click-guard';

/**
 * The drawer: shadcn/ui's Sheet (D-009, style new-york-v4) on Radix's Dialog, not shadcn/ui's
 * Drawer (that one needs vaul). The booking and appointment drawers (E01-T05, E01-T06) and the
 * aftercare review (E06-T08) open in it. Radix keeps the focus inside while it is open, closes it
 * on Escape and on a click outside it, and gives the focus back to what opened it.
 */
function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root {...props} />;
}

/**
 * The props of a button that opens or closes the drawer: Radix's, which are a button's, without
 * formAction and formMethod (D-084), so it never sends its form to another URL or as a GET with
 * every field in the URL (D-076, D-081); and without type, which it sets itself.
 */
type SheetTriggerProps = Omit<
  ComponentProps<typeof SheetPrimitive.Trigger>,
  'formAction' | 'formMethod' | 'type'
>;
type SheetCloseProps = Omit<
  ComponentProps<typeof SheetPrimitive.Close>,
  'formAction' | 'formMethod' | 'type'
>;

/**
 * Opens the drawer. Its button is type="button", written after the props: Radix writes its own
 * before them, where a caller's would win, and in a staff form the one submit button is Send. With
 * asChild it lends these to its child, `<SheetTrigger asChild><Button>…</Button></SheetTrigger>`,
 * whose own type would still win (Radix's Slot): Button has none.
 */
function SheetTrigger(props: SheetTriggerProps) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} type="button" />;
}

/** Closes the drawer; type="button" as SheetTrigger's. */
function SheetClose(props: SheetCloseProps) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} type="button" />;
}

type SheetContentProps = Omit<ComponentProps<typeof SheetPrimitive.Content>, 'title'> & {
  /**
   * The drawer's title, which names it for a screen reader. Required, and never nothing: Radix
   * 1.1.23 names a dialog only when its Title is rendered, and says nothing when it is not.
   */
  title: Exclude<ReactNode, null | undefined | boolean>;
  /** A line under the title, in the muted colour; a screen reader reads it with the drawer. */
  description?: ReactNode;
  /**
   * True while a request of a form inside is on its way (E01-T06e, E01-T05a tester): Escape, a press
   * on the overlay and Close then leave it open, so the form's answer, a refusal too, shows above its
   * button. The caller sets it from its forms' `onSendingChange` and clears it when they have answered.
   */
  busy?: boolean;
  /** 420 px, the default (the appointment drawers), or 500 px (the aftercare review). */
  width?: 420 | 500;
};

/**
 * The open drawer, as the demo draws it (lines 1193–1201): the overlay, which closes it on a click;
 * at the right, the full height, 420 or 500 px wide and never wider than the screen, white with its
 * shadow to the left; a header with the serif title and the round close button in its corner.
 * Below the header come its children: SheetBody, the part that scrolls, then SheetFooter if it has
 * one. It enters as the demo's does, a fade and a 6 px rise in 0.2 s, and at once when the system
 * asks for less motion.
 *
 * The close button comes after the children in the page's order, placed in the header's corner as
 * shadcn/ui's is: Radix gives the first focus to the first control inside, which in the booking
 * drawer is its patient field (E01-T05). Its label comes from the message file.
 *
 * The overlay and the drawer sit on one level, as the dialog's do, and Radix adds them to the page
 * in the order they open: a dialog opened from the drawer covers it with its own overlay. All of
 * them sit under the toast (z-60, toast.tsx), so a toast after a booking shows above the drawer.
 *
 * A double click on what opens it leaves it open (E01-T05a, ./double-click-guard.ts): for half a
 * second after it opens, a pointer down outside it is ignored, and so is a press of the close button
 * by a pointer (where the opener sits under the corner, the second click lands on it); then a click
 * on the overlay or on the close button closes it. Escape, and a key on the close button, always do.
 * And the double click's second press changes nothing in it (E01-T05c): for that half second a
 * pointer's press in it or on the overlay moves no focus and reaches no control, so the first field
 * keeps the focus; a key always works.
 *
 * Two guards for the forms inside (E01-T06e). While `busy` is set, the drawer stays open on Escape, on
 * a press on the overlay and on Close. And a `submit` from a form inside goes no further than the
 * drawer's content: React passes it up its tree through the portal, and a drawer or dialog opened from
 * inside another form would send that form as well.
 */
function SheetContent({
  title,
  description,
  width = 420,
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
}: SheetContentProps) {
  const t = useTranslations('drawer');
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
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-40 bg-overlay"
        {...guard.overlay}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-width={width}
        className={cn(
          'fixed inset-y-0 right-0 z-40 flex max-w-full flex-col bg-surface text-text shadow-drawer outline-none motion-safe:animate-drawer',
          width === 500 ? 'w-125' : 'w-105',
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
          // sends itself only, never a form that holds this drawer's opener (E00-T04e review).
          event.stopPropagation();
        }}
        {...props}
        {...guard.content}
      >
        <div
          data-slot="sheet-header"
          className="shrink-0 border-b border-border pt-5.5 pr-16.5 pb-4 pl-6"
        >
          <SheetPrimitive.Title data-slot="sheet-title" className="font-serif text-title">
            {title}
          </SheetPrimitive.Title>
          {description ? (
            <SheetPrimitive.Description data-slot="sheet-description" className="mt-0.5 text-muted">
              {description}
            </SheetPrimitive.Description>
          ) : null}
        </div>
        {children}
        <SheetClose
          {...guard.close}
          onClick={(event) => {
            guard.close.onClick(event);
            if (busy) event.preventDefault();
          }}
          className="absolute top-5.5 right-6 inline-flex size-8 items-center justify-center rounded-pill bg-border/50 text-text transition-colors outline-none hover:bg-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid"
        >
          <XIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">{t('close')}</span>
        </SheetClose>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

/** The drawer's middle, the demo's (line 1205): it scrolls when its content is taller than it. */
function SheetBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-6 py-4.5',
        className,
      )}
      {...props}
    />
  );
}

/** The drawer's foot, the demo's (line 1253): its buttons in a row over a border line. */
function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('flex shrink-0 flex-wrap gap-2 border-t border-border px-6 py-3.5', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetTrigger,
  type SheetCloseProps,
  type SheetContentProps,
  type SheetTriggerProps,
};
