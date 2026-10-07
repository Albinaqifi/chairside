import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  type DialogCloseProps,
  type DialogContentProps,
  type DialogTriggerProps,
} from './dialog';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  type SheetCloseProps,
  type SheetContentProps,
  type SheetTriggerProps,
} from './sheet';

// E00-T04e: the drawer and the dialog, as the server renders them. Their content opens in a portal,
// which renders nothing on the server: the open drawer and dialog (the overlay, the title a screen
// reader reads, the focus, Escape, the entry) are checked in a browser, with the screenshots next
// to the handoff note. Here, what holds without one: the buttons outside the content, and the
// types. Texts are their keys.

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

interface Kind {
  name: string;
  Root: ComponentType<{ children?: ReactNode; defaultOpen?: boolean }>;
  Trigger: ComponentType<SheetTriggerProps>;
  Close: ComponentType<SheetCloseProps>;
  Content: ComponentType<{ title: string; children?: ReactNode }>;
}

const KINDS: Kind[] = [
  {
    name: 'the drawer',
    Root: Sheet,
    Trigger: SheetTrigger,
    Close: SheetClose,
    Content: SheetContent,
  },
  {
    name: 'the dialog',
    Root: Dialog,
    Trigger: DialogTrigger,
    Close: DialogClose,
    Content: DialogContent,
  },
];

/** `children` in the root, inside a form as a staff form's would be, as the server renders it. */
function inForm({ Root }: Kind, ...children: ReactNode[]): string {
  return renderToString(createElement('form', null, createElement(Root, null, ...children)));
}

describe.each(KINDS)('$name', (kind) => {
  const { Trigger, Close, Root, Content } = kind;

  it('a trigger and a close button outside the content are type="button", even when a caller says submit', () => {
    const plain = inForm(
      kind,
      createElement(Trigger, null, 'open'),
      createElement(Close, null, 'close'),
    );
    expect(tags(plain, 'button').map((button) => button.get('type'))).toEqual(['button', 'button']);
    // `type` is not among their props; past the type checker, both still say "button".
    const toldSubmit = { type: 'submit' } as never;
    const told = inForm(
      kind,
      createElement(Trigger, toldSubmit, 'open'),
      createElement(Close, toldSubmit, 'close'),
    );
    expect(tags(told, 'button').map((button) => button.get('type'))).toEqual(['button', 'button']);
  });

  it('a trigger and a close button outside the content stay type="button" when a caller says reset (E00-T04e tester)', () => {
    // "whatever type a caller passes": a reset button in a staff form would empty every field.
    const toldReset = { type: 'reset' } as never;
    const html = inForm(
      kind,
      createElement(Trigger, toldReset, 'open'),
      createElement(Close, toldReset, 'close'),
    );
    expect(tags(html, 'button').map((button) => button.get('type'))).toEqual(['button', 'button']);
  });

  it('with asChild, they lend type="button" to the Button they hold, which has no type of its own', () => {
    const alone = renderToString(createElement(Button, null, 'alone'));
    expect(tags(alone, 'button')[0]?.has('type')).toBe(false);
    const html = inForm(
      kind,
      createElement(
        Trigger,
        { asChild: true },
        createElement(Button, { variant: 'secondary' }, 'open'),
      ),
      createElement(Close, { asChild: true }, createElement(Button, null, 'close')),
    );
    const buttons = tags(html, 'button');
    expect(buttons.map((button) => button.get('type'))).toEqual(['button', 'button']);
    expect(buttons[0]?.get('aria-haspopup')).toBe('dialog');
  });

  it('its trigger tells a screen reader that it opens a dialog, closed until pressed', () => {
    const [trigger] = tags(inForm(kind, createElement(Trigger, null, 'open')), 'button');
    expect(trigger?.get('aria-haspopup')).toBe('dialog');
    expect(trigger?.get('aria-expanded')).toBe('false');
    expect(trigger?.get('data-state')).toBe('closed');
  });

  it('renders on the server without its content, open or not: the content opens in the browser, in a portal', () => {
    const html = renderToString(
      createElement(
        Root,
        { defaultOpen: true },
        createElement(Content, { title: 'its title' }, 'what it holds'),
      ),
    );
    expect(html).not.toContain('its title');
    expect(html).not.toContain('what it holds');
  });
});

describe('the props of the drawer and the dialog (D-084)', () => {
  it('leave formAction, formMethod and type out of a trigger and a close button, so neither can send its form', () => {
    expectTypeOf<SheetTriggerProps>().not.toHaveProperty('formAction');
    expectTypeOf<SheetTriggerProps>().not.toHaveProperty('formMethod');
    expectTypeOf<SheetTriggerProps>().not.toHaveProperty('type');
    expectTypeOf<SheetCloseProps>().not.toHaveProperty('formAction');
    expectTypeOf<SheetCloseProps>().not.toHaveProperty('formMethod');
    expectTypeOf<SheetCloseProps>().not.toHaveProperty('type');
    expectTypeOf<DialogTriggerProps>().not.toHaveProperty('formAction');
    expectTypeOf<DialogTriggerProps>().not.toHaveProperty('formMethod');
    expectTypeOf<DialogTriggerProps>().not.toHaveProperty('type');
    expectTypeOf<DialogCloseProps>().not.toHaveProperty('formAction');
    expectTypeOf<DialogCloseProps>().not.toHaveProperty('formMethod');
    expectTypeOf<DialogCloseProps>().not.toHaveProperty('type');
  });

  it('a drawer or a dialog without a title does not compile, nor one whose title may be nothing', () => {
    const maybe = undefined as string | undefined;
    // Each @ts-expect-error fails the type check if the line below it ever compiles.
    // @ts-expect-error a drawer without a title: Radix would name it nothing, and say nothing
    const untitledDrawer: SheetContentProps = { children: 'what it holds' };
    // @ts-expect-error a dialog without a title
    const untitledDialog: DialogContentProps = { children: 'what it holds' };
    // @ts-expect-error a title that may be undefined is no title
    const maybeTitledDrawer: SheetContentProps = { title: maybe };
    // @ts-expect-error nor is null
    const nullTitledDialog: DialogContentProps = { title: null };
    const titled: SheetContentProps = { title: 'A title', description: 'and a line under it' };
    expect([
      untitledDrawer,
      untitledDialog,
      maybeTitledDrawer,
      nullTitledDialog,
      titled,
    ]).toHaveLength(5);
  });

  it('nor one whose title may be false, as `shown && title` is (E00-T04e tester)', () => {
    const shown = false as boolean;
    const maybeFalse = shown && 'A title';
    // @ts-expect-error a title that may be false renders nothing: the drawer would have no name
    const falseTitledDrawer: SheetContentProps = { title: maybeFalse };
    // @ts-expect-error nor would the dialog
    const falseTitledDialog: DialogContentProps = { title: maybeFalse };
    expect([falseTitledDrawer, falseTitledDialog]).toHaveLength(2);
  });

  it('the drawer is 420 or 500 px wide, nothing else', () => {
    expectTypeOf<SheetContentProps['width']>().toEqualTypeOf<420 | 500 | undefined>();
  });
});
