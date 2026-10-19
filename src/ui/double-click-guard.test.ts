import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogContent } from './dialog';
import {
  DOUBLE_CLICK_MS,
  withinDoubleClick,
  type CloseButtonHandlers,
  type GuardedHandlers,
} from './double-click-guard';
import { SheetContent } from './sheet';

// E01-T05a (E00-T04e tester, note 1): a double click on what opens the drawer or the dialog leaves it
// open. The rule, and the handlers the drawer's and the dialog's content hand Radix: its Content and
// its Close are stand-ins here that keep the props they are given (the Content renders what it holds,
// so its corner Close is rendered too), and each event carries the time stamp a case gives it. The
// double click itself, in three browsers: tests/e2e/booking.spec.ts and the tester.

const radix = vi.hoisted(() => ({
  content: [] as Record<string, unknown>[],
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
      Overlay: () => null,
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
