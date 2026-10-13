import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogContent } from './dialog';
import { DOUBLE_CLICK_MS, withinDoubleClick, type GuardedHandlers } from './double-click-guard';
import { SheetContent } from './sheet';

// E01-T05a (E00-T04e tester, note 1): a double click on what opens the drawer or the dialog leaves it
// open. The rule, and the handlers the drawer's and the dialog's content hand Radix: its Content is a
// stand-in here that keeps the props it is given, and each event carries the time stamp a case gives
// it. The double click itself, in three browsers: tests/e2e/booking.spec.ts and the tester.

const radix = vi.hoisted(() => ({ content: [] as Record<string, unknown>[] }));
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const children = ({ children: inside }: { children?: ReactNode }) => inside ?? null;
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Portal: children,
      Overlay: () => null,
      Content: (props: Record<string, unknown>) => {
        radix.content.push(props);
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
