import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogContent } from './dialog';
import {
  DOUBLE_CLICK_MS,
  withinDoubleClick,
  type CloseButtonHandlers,
  type GuardedHandlers,
  type OverlayHandlers,
} from './double-click-guard';
import { SheetContent } from './sheet';

// E01-T05a (E00-T04e tester, note 1): a double click on what opens the drawer or the dialog leaves it
// open. The rule, and the handlers the drawer's and the dialog's content hand Radix: its Content and
// its Close are stand-ins here that keep the props they are given (the Content renders what it holds,
// so its corner Close is rendered too), and each event carries the time stamp a case gives it. The
// double click itself, in three browsers: tests/e2e/booking.spec.ts and the tester.

const radix = vi.hoisted(() => ({
  content: [] as Record<string, unknown>[],
  overlay: [] as Record<string, unknown>[],
  close: [] as Record<string, unknown>[],
}));
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const children = ({ children: inside }: { children?: ReactNode }) => inside ?? null;
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Portal: children,
      Overlay: (props: Record<string, unknown>) => {
        radix.overlay.push(props);
        return null;
      },
      Title: children,
      Description: children,
      Content: (props: Record<string, unknown>) => {
        radix.content.push(props);
        return (props.children as ReactNode) ?? null;
      },
      Close: (props: Record<string, unknown>) => {
        radix.close.push(props);
        return null;
      },
    },
  };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

beforeEach(() => {
  radix.content.length = 0;
  radix.overlay.length = 0;
  radix.close.length = 0;
});

type OpenEvent = Parameters<GuardedHandlers['onOpenAutoFocus']>[0];
type OutsideEvent = Parameters<GuardedHandlers['onPointerDownOutside']>[0];

/** The event Radix sends when it moves the focus into the opened content, stamped `timeStamp`. */
function opening(timeStamp: number): OpenEvent {
  return { type: 'focusScope.autoFocusOnMount', timeStamp } as unknown as OpenEvent;
}

/** A pointer down outside, pressed at `timeStamp`, as Radix hands it to onPointerDownOutside. */
function pointerDownOutside(timeStamp: number): OutsideEvent & {
  preventDefault: ReturnType<typeof vi.fn>;
} {
  const event = {
    defaultPrevented: false,
    detail: { originalEvent: { type: 'pointerdown', timeStamp } },
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
  };
  return event as unknown as ReturnType<typeof pointerDownOutside>;
}

describe('a pointer down outside within a double click of the opening', () => {
  it('less than 500 ms after it opened: yes; from 500 ms on, or never opened: no', () => {
    expect(DOUBLE_CLICK_MS).toBe(500);
    expect(withinDoubleClick(1000, 1000)).toBe(true);
    expect(withinDoubleClick(1000, 1080)).toBe(true);
    expect(withinDoubleClick(1000, 1499)).toBe(true);
    expect(withinDoubleClick(1000, 1500)).toBe(false);
    expect(withinDoubleClick(1000, 2000)).toBe(false);
    expect(withinDoubleClick(null, 1000)).toBe(false);
  });

  it('a press made before the opening was stamped is the double click’s own: a busy page took it in late', () => {
    expect(withinDoubleClick(1300, 1150)).toBe(true);
  });
});

const KINDS: { name: string; Content: ComponentType<Record<string, unknown>> }[] = [
  { name: 'the drawer', Content: SheetContent as ComponentType<Record<string, unknown>> },
  { name: 'the dialog', Content: DialogContent as ComponentType<Record<string, unknown>> },
];

describe.each(KINDS)("$name's content", ({ Content }) => {
  /** Renders the content with these props of the caller's, and gives the handlers Radix got. */
  function handlersGiven(caller: Record<string, unknown> = {}): GuardedHandlers {
    renderToString(createElement(Content, { title: 'A title', ...caller }));
    const props = radix.content.at(-1);
    if (!props) throw new Error("Radix's Content was not rendered");
    return props as unknown as GuardedHandlers;
  }

  it('keeps open on the second click of a double click, 80, 150 or 250 ms after it opened', () => {
    const { onOpenAutoFocus, onPointerDownOutside } = handlersGiven();
    onOpenAutoFocus(opening(5000));
    for (const after of [80, 150, 250, 499]) {
      const event = pointerDownOutside(5000 + after);
      onPointerDownOutside(event);
      expect(event.preventDefault, `${after} ms`).toHaveBeenCalledOnce();
    }
  });

  it('a click outside from half a second after it opened closes it, as before', () => {
    const { onOpenAutoFocus, onPointerDownOutside } = handlersGiven();
    onOpenAutoFocus(opening(5000));
    for (const after of [500, 1000, 60_000]) {
      const event = pointerDownOutside(5000 + after);
      onPointerDownOutside(event);
      expect(event.preventDefault, `${after} ms`).not.toHaveBeenCalled();
    }
  });

  it('counts from each opening: opened again later, the next double click is guarded again', () => {
    const { onOpenAutoFocus, onPointerDownOutside } = handlersGiven();
    onOpenAutoFocus(opening(1000));
    const late = pointerDownOutside(9100);
    onPointerDownOutside(late);
    expect(late.preventDefault).not.toHaveBeenCalled();
    onOpenAutoFocus(opening(9000));
    const again = pointerDownOutside(9100);
    onPointerDownOutside(again);
    expect(again.preventDefault).toHaveBeenCalledOnce();
  });

  it("runs the caller's own handlers first, with the same events", () => {
    const calls: string[] = [];
    const callerOpen = vi.fn(() => calls.push('caller open'));
    const callerOutside = vi.fn(() => calls.push('caller outside'));
    const { onOpenAutoFocus, onPointerDownOutside } = handlersGiven({
      onOpenAutoFocus: callerOpen,
      onPointerDownOutside: callerOutside,
    });
    const opened = opening(0);
    onOpenAutoFocus(opened);
    const event = pointerDownOutside(100);
    event.preventDefault.mockImplementation(() => calls.push('guard'));
    onPointerDownOutside(event);
    expect(callerOpen).toHaveBeenCalledWith(opened);
    expect(callerOutside).toHaveBeenCalledWith(event);
    expect(calls).toEqual(['caller open', 'caller outside', 'guard']);
  });

  it('never prevents a pointer down outside before it ever opened', () => {
    const { onPointerDownOutside } = handlersGiven();
    const event = pointerDownOutside(0);
    onPointerDownOutside(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

type PressEvent = Parameters<CloseButtonHandlers['onPointerDown']>[0];
type KeyEvent = Parameters<CloseButtonHandlers['onKeyDown']>[0];
type ClickEvent = Parameters<CloseButtonHandlers['onClick']>[0];

/** A pointer pressed on the close button at `timeStamp`. */
function pressOnClose(timeStamp: number): PressEvent {
  return { type: 'pointerdown', timeStamp } as unknown as PressEvent;
}

/** A key pressed on the close button: Enter, or Space, whose click comes when it is let go. */
function keyOnClose(key: 'Enter' | ' '): KeyEvent {
  return { type: 'keydown', key } as unknown as KeyEvent;
}

/** The close button's click, which closes the layer unless it is prevented (Radix's Close). */
function clickOnClose(): ClickEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  const event = {
    type: 'click',
    defaultPrevented: false,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
  };
  return event as unknown as ReturnType<typeof clickOnClose>;
}

// The second click of a double click lands on the close button where the opener sits under the
// content's corner: New appointment's right part, 1280–1536 px wide (E01-T05a tester, finding 1).
describe.each(KINDS)("$name's close button, in its corner", ({ Content }) => {
  /** Renders the content, and gives the handlers Radix's Content and its Close got. */
  function rendered(): { content: GuardedHandlers; close: CloseButtonHandlers } {
    renderToString(createElement(Content, { title: 'A title' }));
    const content = radix.content.at(-1);
    const close = radix.close.at(-1);
    if (!content || !close) throw new Error("Radix's Content or Close was not rendered");
    return {
      content: content as unknown as GuardedHandlers,
      close: close as unknown as CloseButtonHandlers,
    };
  }

  /** The pointer pressed on it at `timeStamp`, then its click: true when the click was prevented. */
  function pointerClick(close: CloseButtonHandlers, timeStamp: number): boolean {
    close.onPointerDown(pressOnClose(timeStamp));
    const click = clickOnClose();
    close.onClick(click);
    return click.preventDefault.mock.calls.length > 0;
  }

  it("drops the click of a pointer's press 80, 150 or 250 ms after it opened: the double click's second, so it stays open", () => {
    const { content, close } = rendered();
    content.onOpenAutoFocus(opening(5000));
    for (const after of [80, 150, 250, 499]) {
      expect(pointerClick(close, 5000 + after), `${after} ms`).toBe(true);
    }
  });

  it('a press made before the opening was stamped is the double click’s too: a busy page took it in late', () => {
    const { content, close } = rendered();
    content.onOpenAutoFocus(opening(1300));
    expect(pointerClick(close, 1150)).toBe(true);
  });

  it("a pointer's press from half a second after it opened closes it, as before", () => {
    const { content, close } = rendered();
    content.onOpenAutoFocus(opening(5000));
    for (const after of [500, 1000, 60_000]) {
      expect(pointerClick(close, 5000 + after), `${after} ms`).toBe(false);
    }
  });

  it('only the double click’s click is dropped: pressed again on its own a second later, it closes', () => {
    const { content, close } = rendered();
    content.onOpenAutoFocus(opening(5000));
    expect(pointerClick(close, 5150)).toBe(true);
    expect(pointerClick(close, 6200)).toBe(false);
  });

  it('a key on it closes it at once after it opened, also after a press of the pointer let go elsewhere', () => {
    const { content, close } = rendered();
    content.onOpenAutoFocus(opening(5000));
    for (const key of ['Enter', ' '] as const) {
      // Pressed within the double click, then moved off before it was let go: no click came.
      close.onPointerDown(pressOnClose(5100));
      close.onKeyDown(keyOnClose(key));
      const click = clickOnClose();
      close.onClick(click);
      expect(click.preventDefault, key === ' ' ? 'Space' : key).not.toHaveBeenCalled();
    }
  });

  it('a click with no press before it, as a screen reader makes, closes it at once after it opened, and right after a dropped one', () => {
    const { content, close } = rendered();
    content.onOpenAutoFocus(opening(5000));
    const click = clickOnClose();
    close.onClick(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
    // The double click's click is dropped and forgotten: the next click without a press is not.
    expect(pointerClick(close, 5100)).toBe(true);
    const next = clickOnClose();
    close.onClick(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it('counts from each opening, and drops nothing before it ever opened', () => {
    const { content, close } = rendered();
    expect(pointerClick(close, 0)).toBe(false);
    content.onOpenAutoFocus(opening(1000));
    expect(pointerClick(close, 9100)).toBe(false);
    content.onOpenAutoFocus(opening(9000));
    expect(pointerClick(close, 9100)).toBe(true);
  });
});

// E01-T05c: a double click's second press changes nothing anywhere in the content, nor on the overlay.
// The second click lands on whatever opened under the pointer: a chip, a select, the submit button (an
// empty slot of the calendar under the drawer), a status button (E01-T06's block). Its mousedown is
// prevented, which keeps the focus where Radix put it and opens no select's list; its click is
// prevented and stopped in the capture phase, so no control inside sees it.

type CapturedPress = Parameters<GuardedHandlers['onPointerDownCapture']>[0];
type CapturedMouse = Parameters<GuardedHandlers['onMouseDownCapture']>[0];
type CapturedClick = Parameters<GuardedHandlers['onClickCapture']>[0];
type CapturedKey = Parameters<GuardedHandlers['onKeyDownCapture']>[0];

/** A mouse event the guard may prevent and stop: a mousedown, or a click. */
function mouseEvent(type: 'mousedown' | 'click'): CapturedMouse & {
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
} {
  const event = {
    type,
    defaultPrevented: false,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
  };
  return event as unknown as ReturnType<typeof mouseEvent>;
}

/** A pointer pressed at `timeStamp`, whose own default the guard must never prevent. */
function pointerDown(timeStamp: number): CapturedPress & {
  preventDefault: ReturnType<typeof vi.fn>;
} {
  return { type: 'pointerdown', timeStamp, preventDefault: vi.fn() } as unknown as ReturnType<
    typeof pointerDown
  >;
}

describe.each(KINDS)("$name's content: a pointer's press in it (E01-T05c)", ({ Content }) => {
  /** Renders the content with these props of the caller's, and gives the handlers Radix got. */
  function rendered(caller: Record<string, unknown> = {}): GuardedHandlers {
    renderToString(createElement(Content, { title: 'A title', ...caller }));
    const props = radix.content.at(-1);
    if (!props) throw new Error("Radix's Content was not rendered");
    return props as unknown as GuardedHandlers;
  }

  /**
   * A pointer pressed in the content at `timeStamp`, then let go: what the guard did to the press
   * itself, its mousedown (the focus, a select's list) and its click (the control's own handler).
   */
  function press(
    content: GuardedHandlers,
    timeStamp: number,
  ): { downPrevented: boolean; focusKept: boolean; clickDropped: boolean } {
    const down = pointerDown(timeStamp);
    content.onPointerDownCapture(down);
    const mousedown = mouseEvent('mousedown');
    content.onMouseDownCapture(mousedown);
    const click = mouseEvent('click');
    content.onClickCapture(click as unknown as CapturedClick);
    const dropped = click.preventDefault.mock.calls.length > 0;
    expect(click.stopPropagation.mock.calls.length > 0, 'a dropped click is stopped too').toBe(
      dropped,
    );
    return {
      downPrevented: down.preventDefault.mock.calls.length > 0,
      focusKept: mousedown.preventDefault.mock.calls.length > 0,
      clickDropped: dropped,
    };
  }

  it('80, 150 or 250 ms after it opened: no focus moves and its click reaches nothing; the press itself is left to Radix', () => {
    const content = rendered();
    content.onOpenAutoFocus(opening(5000));
    for (const after of [80, 150, 250, 499]) {
      expect(press(content, 5000 + after), `${after} ms`).toEqual({
        downPrevented: false,
        focusKept: true,
        clickDropped: true,
      });
    }
  });

  it('a press made before the opening was stamped is the double click’s too: a busy page took it in late', () => {
    const content = rendered();
    content.onOpenAutoFocus(opening(1300));
    expect(press(content, 1150)).toMatchObject({ focusKept: true, clickDropped: true });
  });

  it('from half a second after it opened a press works as before: the focus moves, the click reaches its control', () => {
    const content = rendered();
    content.onOpenAutoFocus(opening(5000));
    for (const after of [500, 1000, 60_000]) {
      expect(press(content, 5000 + after), `${after} ms`).toEqual({
        downPrevented: false,
        focusKept: false,
        clickDropped: false,
      });
    }
  });

  it('a key always works: its click at once after it opened, also after a press let go elsewhere', () => {
    const content = rendered();
    content.onOpenAutoFocus(opening(5000));
    for (const key of ['Enter', ' ']) {
      // Pressed within the double click, then moved off before it was let go: no click came.
      content.onPointerDownCapture(pointerDown(5100));
      content.onKeyDownCapture({ type: 'keydown', key } as unknown as CapturedKey);
      const click = mouseEvent('click');
      content.onClickCapture(click as unknown as CapturedClick);
      expect(click.preventDefault, key === ' ' ? 'Space' : key).not.toHaveBeenCalled();
      expect(click.stopPropagation, key === ' ' ? 'Space' : key).not.toHaveBeenCalled();
    }
  });

  it('a click with no press before it, as a screen reader makes, works at once after it opened, and right after a dropped one', () => {
    const content = rendered();
    content.onOpenAutoFocus(opening(5000));
    const first = mouseEvent('click');
    content.onClickCapture(first as unknown as CapturedClick);
    expect(first.preventDefault).not.toHaveBeenCalled();
    expect(press(content, 5100).clickDropped).toBe(true);
    const next = mouseEvent('click');
    content.onClickCapture(next as unknown as CapturedClick);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it('counts from each opening, and drops nothing before it ever opened', () => {
    const content = rendered();
    expect(press(content, 0).clickDropped).toBe(false);
    content.onOpenAutoFocus(opening(1000));
    expect(press(content, 9100).clickDropped).toBe(false);
    content.onOpenAutoFocus(opening(9000));
    expect(press(content, 9100).clickDropped).toBe(true);
  });

  it("runs the caller's own capture handlers first, with the same events", () => {
    const calls: string[] = [];
    const caller = {
      onPointerDownCapture: vi.fn(() => calls.push('caller press')),
      onMouseDownCapture: vi.fn(() => calls.push('caller mousedown')),
      onClickCapture: vi.fn(() => calls.push('caller click')),
      onKeyDownCapture: vi.fn(() => calls.push('caller key')),
    };
    const content = rendered(caller);
    content.onOpenAutoFocus(opening(0));
    const down = pointerDown(100);
    content.onPointerDownCapture(down);
    const mousedown = mouseEvent('mousedown');
    mousedown.preventDefault.mockImplementation(() => calls.push('guard mousedown'));
    content.onMouseDownCapture(mousedown);
    const click = mouseEvent('click');
    click.preventDefault.mockImplementation(() => calls.push('guard click'));
    content.onClickCapture(click as unknown as CapturedClick);
    const key = { type: 'keydown', key: 'Tab' } as unknown as CapturedKey;
    content.onKeyDownCapture(key);
    expect(caller.onPointerDownCapture).toHaveBeenCalledWith(down);
    expect(caller.onMouseDownCapture).toHaveBeenCalledWith(mousedown);
    expect(caller.onClickCapture).toHaveBeenCalledWith(click);
    expect(caller.onKeyDownCapture).toHaveBeenCalledWith(key);
    expect(calls).toEqual([
      'caller press',
      'caller mousedown',
      'guard mousedown',
      'caller click',
      'guard click',
      'caller key',
    ]);
  });
});

type OverlayPress = Parameters<OverlayHandlers['onPointerDown']>[0];
type OverlayMouse = Parameters<OverlayHandlers['onMouseDown']>[0];

describe.each(KINDS)("$name's overlay: a press on it (E01-T05c)", ({ Content }) => {
  /** Renders the content, and gives the handlers Radix's Content and the overlay got. */
  function rendered(): { content: GuardedHandlers; overlay: OverlayHandlers } {
    renderToString(createElement(Content, { title: 'A title' }));
    const content = radix.content.at(-1);
    const overlay = radix.overlay.at(-1);
    if (!content || !overlay) throw new Error("Radix's Content or Overlay was not rendered");
    return {
      content: content as unknown as GuardedHandlers,
      overlay: overlay as unknown as OverlayHandlers,
    };
  }

  /** A pointer pressed on the overlay at `timeStamp`, then let go: true when the focus was kept. */
  function focusKept(overlay: OverlayHandlers, timeStamp: number): boolean {
    overlay.onPointerDown(pointerDown(timeStamp) as unknown as OverlayPress);
    const mousedown = mouseEvent('mousedown');
    overlay.onMouseDown(mousedown as unknown as OverlayMouse);
    overlay.onClick(mouseEvent('click') as unknown as OverlayMouse);
    return mousedown.preventDefault.mock.calls.length > 0;
  }

  it('within a double click of the opening it moves no focus (an opener left of the drawer); from half a second on, as before', () => {
    const { content, overlay } = rendered();
    expect(focusKept(overlay, 100), 'before it ever opened').toBe(false);
    content.onOpenAutoFocus(opening(5000));
    for (const after of [80, 150, 250, 499]) {
      expect(focusKept(overlay, 5000 + after), `${after} ms`).toBe(true);
    }
    for (const after of [500, 1000]) {
      expect(focusKept(overlay, 5000 + after), `${after} ms`).toBe(false);
    }
  });

  it('its click forgets the press: a click in the content with no press before it then works', () => {
    const { content, overlay } = rendered();
    content.onOpenAutoFocus(opening(5000));
    expect(focusKept(overlay, 5100)).toBe(true);
    const click = mouseEvent('click');
    content.onClickCapture(click as unknown as CapturedClick);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });
});
