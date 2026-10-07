import fs from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { Checkbox, type CheckboxProps } from './checkbox';
import { NativeSelect, NativeSelectOption } from './native-select';
import { Switch, type SwitchProps } from './switch';
import { Textarea } from './textarea';

// E00-T04d: the four form fields, as the server renders them. How each looks next to the demo, and
// that the keyboard works it, are checked in a browser (the screenshots next to the handoff note);
// here, what holds without one. Tailwind makes no CSS for a class whose colour or radius the theme
// lacks, and says nothing: each token a field's classes name must be in src/app/globals.css.

const theme = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The one `tag` element in `html`. */
function only(html: string, tag: string): Map<string, string> {
  const found = tags(html, tag);
  expect(found, `the ${tag} elements`).toHaveLength(1);
  return found[0] ?? new Map<string, string>();
}

function classesOf(attributes: Map<string, string>): string[] {
  return (attributes.get('class') ?? '').split(' ');
}

/** Rendered inside a form, as a staff form's field is. */
function inForm(field: ReactElement): string {
  return renderToString(createElement('form', null, field));
}

function expectThemeDefines(...tokens: string[]): void {
  for (const token of tokens) expect(theme, token).toContain(`${token}:`);
}

/** A field's control props as Field gives them to a control, with an error's attributes. */
const CONTROL = { id: 'f-id', name: 'f', 'aria-invalid': true, 'aria-describedby': 'f-id-error' };

describe('Textarea', () => {
  it("takes the field's control props: its label names it, its error is read with it", () => {
    const textarea = only(renderToString(createElement(Textarea, CONTROL)), 'textarea');
    expect(textarea.get('id')).toBe('f-id');
    expect(textarea.get('name')).toBe('f');
    expect(textarea.get('aria-invalid')).toBe('true');
    expect(textarea.get('aria-describedby')).toBe('f-id-error');
  });

  it("is the demo's, taller by dragging, with Input's focus and error colours and never the browser's outline", () => {
    const classes = classesOf(only(renderToString(createElement(Textarea)), 'textarea'));
    expect(classes).toEqual(
      expect.arrayContaining([
        'rounded-control',
        'border-border-strong',
        'bg-surface',
        'text-text',
        'min-h-24',
        'resize-y',
        'outline-none',
        'focus-visible:border-focus',
        'focus-visible:ring-focus/25',
        'aria-invalid:border-error',
      ]),
    );
    expectThemeDefines(
      '--radius-control',
      '--color-border-strong',
      '--color-surface',
      '--color-focus',
      '--color-error',
    );
  });

  it("takes a caller's class over its own", () => {
    const html = renderToString(createElement(Textarea, { className: 'min-h-40' }));
    expect(classesOf(only(html, 'textarea'))).toContain('min-h-40');
    expect(classesOf(only(html, 'textarea'))).not.toContain('min-h-24');
  });
});

describe("NativeSelect, the browser's own select", () => {
  function select(props: Parameters<typeof NativeSelect>[0] = {}): string {
    return renderToString(
      createElement(
        NativeSelect,
        props,
        createElement(NativeSelectOption, { value: '' }, 'empty choice'),
        createElement(NativeSelectOption, { value: 'second' }, 'second choice'),
      ),
    );
  }

  it("takes the field's control props on the select itself, not on its wrapper", () => {
    const html = select(CONTROL);
    const control = only(html, 'select');
    expect(control.get('id')).toBe('f-id');
    expect(control.get('name')).toBe('f');
    expect(control.get('aria-invalid')).toBe('true');
    expect(control.get('aria-describedby')).toBe('f-id-error');
    expect(only(html, 'div').has('id')).toBe(false);
  });

  it("sends what it shows: the browser's own options, the chosen one selected in the HTML", () => {
    const options = tags(select({ defaultValue: 'second' }), 'option');
    expect(options.map((option) => option.get('value'))).toEqual(['', 'second']);
    expect(options.map((option) => option.has('selected'))).toEqual([false, true]);
  });

  it('is styled as Input is, with a chevron in the muted colour that a screen reader skips', () => {
    const html = select();
    expect(classesOf(only(html, 'select'))).toEqual(
      expect.arrayContaining([
        'h-10',
        'appearance-none',
        'rounded-control',
        'border-border-strong',
        'bg-surface',
        'outline-none',
        'focus-visible:border-focus',
        'focus-visible:ring-focus/25',
        'aria-invalid:border-error',
      ]),
    );
    const chevron = only(html, 'svg');
    expect(chevron.get('aria-hidden')).toBe('true');
    expect(classesOf(chevron)).toContain('text-muted');
  });

  it("puts a caller's class on the wrapper, which holds the chevron", () => {
    const wrapper = only(select({ className: 'w-40' }), 'div');
    expect(classesOf(wrapper)).toContain('w-40');
    expect(classesOf(wrapper)).not.toContain('w-full');
  });

  it('has one size: the HTML size attribute, which makes a list box, is not among its props', () => {
    expectTypeOf<Parameters<typeof NativeSelect>[0]>().not.toHaveProperty('size');
  });
});

describe.each([
  { name: 'Checkbox', field: Checkbox, role: 'checkbox' },
  { name: 'Switch', field: Switch, role: 'switch' },
] as const)('$name', ({ field, role }) => {
  /** The field with a field's control props, in a form, as the server renders it. */
  function render(extra: { defaultChecked?: boolean } = {}): string {
    return inForm(createElement(field, { ...CONTROL, ...extra }));
  }

  it(`is a button of role ${role} that its label names; its error is read with it`, () => {
    const button = only(render(), 'button');
    expect(button.get('role')).toBe(role);
    expect(button.get('id')).toBe('f-id');
    expect(button.get('aria-invalid')).toBe('true');
    expect(button.get('aria-describedby')).toBe('f-id-error');
  });

  it('never submits its form: its button is type="button", even when a caller says otherwise', () => {
    expect(only(render(), 'button').get('type')).toBe('button');
    // `type` is not among its props; past the type checker, the button still says "button".
    const toldSubmit = { ...CONTROL, type: 'submit' } as never;
    expect(only(inForm(createElement(field, toldSubmit)), 'button').get('type')).toBe('button');
  });

  it('in a form, Radix\'s hidden input under the field\'s name sends "on" when on and nothing when off', () => {
    const off = only(render(), 'input');
    expect(off.get('type')).toBe('checkbox');
    expect(off.get('name')).toBe('f');
    expect(off.get('value')).toBe('on');
    expect(off.get('aria-hidden')).toBe('true');
    expect(off.get('tabindex')).toBe('-1');
    expect(off.has('checked')).toBe(false);
    const on = only(render({ defaultChecked: true }), 'input');
    expect(on.has('checked')).toBe(true);
    // No autocomplete of its own: it takes its form's, "off" in every staff form (D-093).
    expect(on.has('autocomplete')).toBe(false);
  });

  it('shows what it holds: aria-checked and data-state', () => {
    const off = only(render(), 'button');
    expect([off.get('aria-checked'), off.get('data-state')]).toEqual(['false', 'unchecked']);
    const on = only(render({ defaultChecked: true }), 'button');
    expect([on.get('aria-checked'), on.get('data-state')]).toEqual(['true', 'checked']);
  });

  it("is on in accent, its keyboard focus Button's outline in the focus colour, never the browser's own", () => {
    expect(classesOf(only(render(), 'button'))).toEqual(
      expect.arrayContaining([
        'data-[state=checked]:bg-accent',
        'outline-none',
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-focus',
        'focus-visible:outline-solid',
        'aria-invalid:border-error',
      ]),
    );
    expectThemeDefines('--color-accent', '--color-focus', '--color-error');
  });
});

describe('the props of the checkbox and the switch (D-084)', () => {
  it('leave out formAction and formMethod, so neither can send its form elsewhere, and type', () => {
    expectTypeOf<CheckboxProps>().not.toHaveProperty('formAction');
    expectTypeOf<CheckboxProps>().not.toHaveProperty('formMethod');
    expectTypeOf<CheckboxProps>().not.toHaveProperty('type');
    expectTypeOf<SwitchProps>().not.toHaveProperty('formAction');
    expectTypeOf<SwitchProps>().not.toHaveProperty('formMethod');
    expectTypeOf<SwitchProps>().not.toHaveProperty('type');
  });
});

describe('the look of each, after the demo', () => {
  it('Checkbox: an 18 px white box on the checkbox radius and border; ticked, accent with a white mark', () => {
    const html = inForm(createElement(Checkbox, { defaultChecked: true }));
    expect(classesOf(only(html, 'button'))).toEqual(
      expect.arrayContaining([
        'size-4.5',
        'rounded-checkbox',
        'border-checkbox-border',
        'bg-surface',
        'text-on-primary',
        'data-[state=checked]:border-accent',
      ]),
    );
    expectThemeDefines('--radius-checkbox', '--color-checkbox-border', '--color-on-primary');
    expect(only(html, 'svg').get('aria-hidden')).toBe('true');
  });

  it('Switch: a 38 by 22 px pill, off in the switch-off colour, its white knob 16 px further when on', () => {
    const html = inForm(createElement(Switch));
    expect(classesOf(only(html, 'button'))).toEqual(
      expect.arrayContaining([
        'w-9.5',
        'h-5.5',
        'rounded-pill',
        'data-[state=unchecked]:bg-switch-off',
      ]),
    );
    expectThemeDefines('--radius-pill', '--color-switch-off');
    expect(classesOf(only(html, 'span'))).toEqual(
      expect.arrayContaining([
        'size-4',
        'rounded-pill',
        'bg-surface',
        'data-[state=checked]:translate-x-4',
      ]),
    );
  });
});
