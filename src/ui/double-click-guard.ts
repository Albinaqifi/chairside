import type { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef, type ComponentProps } from 'react';

/*
 * A double click on what opens the drawer or the dialog leaves it open (E01-T05a; E00-T04e tester,
 * note 1). The first click opens it, and the second lands on whatever opened under the pointer. On
 * the overlay it is a pointer down outside the content, which Radix answers by closing it (on the
 * click that follows, Dialog 1.1.23); on the close button in the content's corner it is a click of
 * that button, where the opener sits under the corner (New appointment's right part on a screen
 * 1280–1536 px wide: E01-T05a tester, finding 1). So a receptionist who double-clicks "New
 * appointment" saw the drawer flash and go. For as long as a double click lasts after it opens, a
 * pointer down outside is ignored, and so is a press of the close button by a pointer; after that a
 * click on the overlay or on the close button closes it. Escape, and a key on the close button,
 * always do.
 */

/** How long a double click lasts: Windows' default double-click time. */
export const DOUBLE_CLICK_MS = 500;

/**
 * True when a pointer down at `at` belongs to the double click that opened the layer at `openedAt`
 * (both events' time stamps, in milliseconds): less than DOUBLE_CLICK_MS after it, or before it, a
 * press the page took in only after drawing the layer (a slow page, a busy tablet). Never when it
 * never opened.
 */
export function withinDoubleClick(openedAt: number | null, at: number): boolean {
  return openedAt !== null && at - openedAt < DOUBLE_CLICK_MS;
}

type ContentProps = ComponentProps<typeof DialogPrimitive.Content>;

/** The two handlers of Radix's Content the guard takes part in: the caller's own, if any, run first. */
export type GuardedHandlers = Required<
  Pick<ContentProps, 'onOpenAutoFocus' | 'onPointerDownOutside'>
>;

/** The handlers of the close button in the content's corner, which the guard gives it alone. */
export type CloseButtonHandlers = Required<
  Pick<ComponentProps<'button'>, 'onPointerDown' | 'onKeyDown' | 'onClick'>
>;

/** What the guard gives the drawer's and the dialog's content: Radix's Content, its close button. */
export interface DoubleClickGuard {
  content: GuardedHandlers;
  close: CloseButtonHandlers;
}

/**
 * The handlers the drawer's and the dialog's content give Radix: the moment it opens is kept when
 * Radix moves the focus into it, which it does each time it opens; a pointer down outside within a
 * double click of that moment is prevented, so it stays open. The caller's handlers run first, as
 * Radix runs a caller's before its own.
 *
 * And the handlers of the close button in its corner: a click made by a pointer pressed on it within
 * a double click of that moment is the double click's second, and is prevented, which Radix's Close
 * honours (it closes only when its click is not prevented, Dialog 1.1.23). A click made by a key,
 * Enter or Space, is never one: a key pressed on the button forgets a pointer's press that was let
 * go elsewhere, so no click came of it, and a click with no press before it (a screen reader's) is
 * never prevented. The focus is left to the browser, as on the overlay.
 *
 * Each moment is its event's time stamp, the page's own clock in every browser: the opening's (the
 * event Radix sends when it moves the focus in) and the press's (the pointer down Radix hands on, or
 * the close button gets), never the time the handler runs, which a busy page holds back after the
 * click. No change of the computer's time moves them, and Playwright's fake clock does not either.
 */
export function useDoubleClickGuard(caller: Partial<GuardedHandlers>): DoubleClickGuard {
  const openedAt = useRef<number | null>(null);
  // Whether the close button's last press by a pointer came within a double click of the opening.
  const closePressedWithin = useRef(false);
  return {
    content: {
      onOpenAutoFocus: (event) => {
        openedAt.current = event.timeStamp;
        caller.onOpenAutoFocus?.(event);
      },
      onPointerDownOutside: (event) => {
        caller.onPointerDownOutside?.(event);
        if (withinDoubleClick(openedAt.current, event.detail.originalEvent.timeStamp)) {
          event.preventDefault();
        }
      },
    },
    close: {
      onPointerDown: (event) => {
        closePressedWithin.current = withinDoubleClick(openedAt.current, event.timeStamp);
      },
      onKeyDown: () => {
        closePressedWithin.current = false;
      },
      onClick: (event) => {
        if (closePressedWithin.current) event.preventDefault();
        closePressedWithin.current = false;
      },
    },
  };
}
