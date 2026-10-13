import type { Dialog as DialogPrimitive } from 'radix-ui';
import { useRef, type ComponentProps } from 'react';

/*
 * A double click on what opens the drawer or the dialog leaves it open (E01-T05a; E00-T04e tester,
 * note 1). The first click opens it, with its overlay under the pointer; the second lands on the
 * overlay, a pointer down outside the content, which Radix answers by closing it (on the click that
 * follows, Dialog 1.1.23). So a receptionist who double-clicks "New appointment" saw the drawer flash
 * and go. For as long as a double click lasts after it opens, a pointer down outside is ignored; after
 * that a click on the overlay closes it, and Escape and the close button always do.
 */

/** How long a double click lasts: Windows' default double-click time. */
export const DOUBLE_CLICK_MS = 500;

/**
 * True when a pointer down outside at `at` belongs to the double click that opened the layer at
 * `openedAt` (both events' time stamps, in milliseconds): less than DOUBLE_CLICK_MS after it, or
 * before it, a press the page took in only after drawing the layer (a slow page, a busy tablet).
 * Never when it never opened.
 */
export function withinDoubleClick(openedAt: number | null, at: number): boolean {
  return openedAt !== null && at - openedAt < DOUBLE_CLICK_MS;
}

type ContentProps = ComponentProps<typeof DialogPrimitive.Content>;

/** The two handlers of Radix's Content the guard takes part in: the caller's own, if any, run first. */
export type GuardedHandlers = Required<
  Pick<ContentProps, 'onOpenAutoFocus' | 'onPointerDownOutside'>
>;

/**
 * The handlers the drawer's and the dialog's content give Radix: the moment it opens is kept when
 * Radix moves the focus into it, which it does each time it opens; a pointer down outside within a
 * double click of that moment is prevented, so it stays open. The caller's handlers run first, as
 * Radix runs a caller's before its own.
 *
 * Each moment is its event's time stamp, the page's own clock in every browser: the opening's (the
 * event Radix sends when it moves the focus in) and the press's (the pointer down Radix hands on),
 * never the time the handler runs, which a busy page holds back after the click. No change of the
 * computer's time moves them, and Playwright's fake clock does not either.
 */
export function useDoubleClickGuard(caller: Partial<GuardedHandlers>): GuardedHandlers {
  const openedAt = useRef<number | null>(null);
  return {
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
  };
}
