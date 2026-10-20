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
 *
 * And a double click's second press changes nothing anywhere in it (E01-T05c): on a field, a chip, a
 * select or a submit button, where an opener under the content puts it (an empty slot of the
 * calendar, E01-T05c; an appointment's block, E01-T06, whose drawer holds status buttons). For as long
 * as a double click lasts after it opens, a pointer's press in the content or on the overlay moves no
 * focus and opens no select's list (its mousedown is prevented), and its click reaches nothing (it is
 * prevented and stopped before the control's own handler), so the first field keeps the focus Radix
 * gave it. A key always works, and so does a pointer from half a second on.
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

/** The handlers of Radix's Content the guard takes part in: the caller's own, if any, run first. */
export type GuardedHandlers = Required<
  Pick<
    ContentProps,
    | 'onOpenAutoFocus'
    | 'onPointerDownOutside'
    | 'onPointerDownCapture'
    | 'onMouseDownCapture'
    | 'onClickCapture'
    | 'onKeyDownCapture'
  >
>;

/** The handlers of the overlay, which the guard gives it alone. */
export type OverlayHandlers = Required<
  Pick<ComponentProps<'div'>, 'onPointerDown' | 'onMouseDown' | 'onClick'>
>;

/** The handlers of the close button in the content's corner, which the guard gives it alone. */
export type CloseButtonHandlers = Required<
  Pick<ComponentProps<'button'>, 'onPointerDown' | 'onKeyDown' | 'onClick'>
>;

/**
 * What the guard gives the drawer's and the dialog's content: Radix's Content, its overlay, its close
 * button.
 */
export interface DoubleClickGuard {
  content: GuardedHandlers;
  overlay: OverlayHandlers;
  close: CloseButtonHandlers;
}

/**
 * The handlers the drawer's and the dialog's content give Radix: the moment it opens is kept when
 * Radix moves the focus into it, which it does each time it opens; a pointer down outside within a
 * double click of that moment is prevented, so it stays open. The caller's handlers run first, as
 * Radix runs a caller's before its own.
 *
 * A pointer's press within a double click of that moment, in the content or on the overlay, is
 * dropped (E01-T05c): its mousedown is prevented, which keeps the focus where it is and opens no
 * select's list (as the patient field's suggestions keep it, calendar/patient-field.tsx), and so is
 * its click, which is also stopped in the capture phase, before any control inside sees it: a chip
 * is not pressed, a select not changed, a form not sent. The pointer down itself is never prevented:
 * Radix marks a press inside the content on it (DismissableLayer's onPointerDownCapture runs only when
 * it is not prevented). A key forgets such a press, so a click made by Enter or Space is never one,
 * and so does the click, so a click with no press before it (a screen reader's) is not either.
 *
 * And the handlers of the close button in its corner: a click made by a pointer pressed on it within
 * a double click of that moment is the double click's second, and is prevented, which Radix's Close
 * honours (it closes only when its click is not prevented, Dialog 1.1.23). A click made by a key,
 * Enter or Space, is never one: a key pressed on the button forgets a pointer's press that was let
 * go elsewhere, so no click came of it, and a click with no press before it (a screen reader's) is
 * never prevented. The content's handlers drop that click first; the close button keeps its own, the
 * same rule on the same press, for a content without them.
 *
 * Each moment is its event's time stamp, the page's own clock in every browser: the opening's (the
 * event Radix sends when it moves the focus in) and the press's (the pointer down Radix hands on, or
 * the content, the overlay or the close button gets), never the time the handler runs, which a busy
 * page holds back after the click. No change of the computer's time moves them. Playwright's fake
 * clock does: once installed, it gives every event the fake time at which the event's time stamp is
 * first read (Playwright 1.63), so a test that stops that clock sees every press at the moment the
 * layer opened, a double click's, until it moves the clock on.
 */
export function useDoubleClickGuard(caller: Partial<GuardedHandlers>): DoubleClickGuard {
  const openedAt = useRef<number | null>(null);
  // Whether the last press by a pointer, in the content, on the overlay or on the close button, came
  // within a double click of the opening: then its mousedown and its click are dropped.
  const pressDropped = useRef(false);
  const press = (timeStamp: number) => {
    pressDropped.current = withinDoubleClick(openedAt.current, timeStamp);
  };
  const keepFocus = (event: { preventDefault: () => void }) => {
    if (pressDropped.current) event.preventDefault();
  };
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
      onPointerDownCapture: (event) => {
        caller.onPointerDownCapture?.(event);
        press(event.timeStamp);
      },
      onMouseDownCapture: (event) => {
        caller.onMouseDownCapture?.(event);
        keepFocus(event);
      },
      onClickCapture: (event) => {
        caller.onClickCapture?.(event);
        if (pressDropped.current) {
          event.preventDefault();
          event.stopPropagation();
        }
        pressDropped.current = false;
      },
      onKeyDownCapture: (event) => {
        caller.onKeyDownCapture?.(event);
        pressDropped.current = false;
      },
    },
    overlay: {
      onPointerDown: (event) => {
        press(event.timeStamp);
      },
      onMouseDown: keepFocus,
      onClick: () => {
        pressDropped.current = false;
      },
    },
    close: {
      onPointerDown: (event) => {
        press(event.timeStamp);
      },
      onKeyDown: () => {
        pressDropped.current = false;
      },
      onClick: (event) => {
        if (pressDropped.current) event.preventDefault();
        pressDropped.current = false;
      },
    },
  };
}
