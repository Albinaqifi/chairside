import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import { DemoForm } from './demo-form';

// E00-T04d, acceptance 2, 3 and 4 (the parts a unit test reaches): the demo form on /dev/components
// as the server sends it. One submit button, Send; a form that keeps nothing in the browser; each
// new field named by its label, its error at it, and sending what it shows. React renders it as the
// server does; useActionState is replaced so that a test can choose the form's answer. The texts are
// their keys. The tester checks the rest in a browser: the network log, F5 and Back in Firefox.

const form = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useActionState: (_bridge: unknown, initial: unknown) => [
      form.state ?? initial,
      () => undefined,
      false,
    ],
  };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// The demo's actions are server code; the form only hands them to StaffForm.
vi.mock('./actions', () => ({ demoAnswer: vi.fn(), demoOwnerOnly: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000f1';

beforeEach(() => {
  form.state = undefined;
});

/** The demo form in a staff frame, as the server renders it, with the answer given. */
function render(answer?: FormAnswer<unknown>): string {
  if (answer) form.state = { answer, attempt: 1 };
  const frame: ComponentProps<typeof FrameClinic> = {
    clinicId: CLINIC,
    children: createElement(DemoForm),
  };
  return renderToString(createElement(FrameClinic, frame));
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The first `tag` element whose attribute `name` is `value`. */
function find(html: string, tag: string, name: string, value: string): Map<string, string> {
  const found = tags(html, tag).find((attributes) => attributes.get(name) === value);
  if (!found) throw new Error(`no ${tag} with ${name}="${value}"`);
  return found;
}

/** The text of the label for the control whose id is `id`, without tags. */
function labelFor(html: string, id: string): string | undefined {
  const match = new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html);
  return match?.[1]?.replace(/<[^>]*>/g, '');
}

/** The text of the element whose id is `id`, without tags. */
function textOfId(html: string, id: string): string | undefined {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2]?.replace(/<[^>]*>/g, '');
}

describe('the demo form, as the server sends it (E00-T04d)', () => {
  it('holds one submit button, Send: every other button is type="button" (acceptance 4)', () => {
    const html = render();
    const buttons = tags(html, 'button');
    const submitButtons = buttons.filter(
      (button) => (button.get('type') ?? 'submit').toLowerCase() === 'submit',
    );
    const submitInputs = tags(html, 'input').filter((input) =>
      ['submit', 'image'].includes((input.get('type') ?? 'text').toLowerCase()),
    );
    expect(submitButtons).toHaveLength(1);
    expect(submitInputs).toHaveLength(0);
    // E00-T04d tester: every button but Send writes type="button" itself. An empty or unknown type
    // submits the form too (HTML's default), and the filter above counts those as not submitting.
    expect(buttons.filter((button) => button.get('type')?.toLowerCase() !== 'button')).toHaveLength(
      1,
    );
    // The checkbox's and the switch's buttons are there, and are not submit buttons.
    expect(buttons.map((button) => button.get('role') ?? button.get('type'))).toEqual([
      'checkbox',
      'switch',
      'submit',
    ]);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>devComponents\.form\.submit<\/button>/);
  });

  it('keeps nothing in the browser: autocomplete="off" on its form, and no field asks for it back (acceptance 3)', () => {
    const html = render();
    const [attributes] = tags(html, 'form');
    expect(attributes?.get('autocomplete')).toBe('off');
    const fields = [...tags(html, 'input'), ...tags(html, 'textarea'), ...tags(html, 'select')];
    expect(fields.length).toBeGreaterThanOrEqual(10); // 2 inputs, 4 radios, the hidden 2, a textarea, a select
    for (const field of fields) expect(field.get('autocomplete') ?? 'off').toBe('off');
  });

  it('names each new field by its label, under the name its action reads', () => {
    const html = render();
    const details = find(html, 'textarea', 'name', 'details');
    expect(labelFor(html, details.get('id') ?? '')).toBe('devComponents.form.details');
    const choice = find(html, 'select', 'name', 'choice');
    expect(labelFor(html, choice.get('id') ?? '')).toBe('devComponents.form.choice');
    const checkbox = find(html, 'button', 'role', 'checkbox');
    expect(labelFor(html, checkbox.get('id') ?? '')).toBe('devComponents.form.checkbox');
    const switchButton = find(html, 'button', 'role', 'switch');
    expect(labelFor(html, switchButton.get('id') ?? '')).toBe('devComponents.form.switch');
    // What the checkbox and the switch send is Radix's hidden input under the field's name.
    expect(find(html, 'input', 'name', 'checkbox').get('type')).toBe('checkbox');
    expect(find(html, 'input', 'name', 'switch').get('type')).toBe('checkbox');
  });

  it('starts at what it sends: details empty, the empty choice, the checkbox and the switch off', () => {
    const html = render();
    expect(html).toMatch(/<textarea[^>]*name="details"[^>]*><\/textarea>/);
    const options = tags(html, 'option');
    expect(options[0]?.get('value')).toBe('');
    expect(options.filter((option) => option.has('selected')).map((o) => o.get('value'))).toEqual([
      '',
    ]);
    expect(html).toContain('>devComponents.choices.empty</option>');
    // Off, a checkbox's or a switch's hidden input is not checked: the form sends no value for it.
    expect(find(html, 'input', 'name', 'checkbox').has('checked')).toBe(false);
    expect(find(html, 'input', 'name', 'switch').has('checked')).toBe(false);
    expect(find(html, 'button', 'role', 'checkbox').get('aria-checked')).toBe('false');
    expect(find(html, 'button', 'role', 'switch').get('aria-checked')).toBe('false');
  });

  it("shows the textarea's and the select's errors at them, tied for screen readers (acceptance 2)", () => {
    const html = render({
      kind: 'invalid',
      fields: new Map([
        ['details', 'missing'],
        ['choice', 'missing'],
      ]),
    });
    for (const [tag, name] of [
      ['textarea', 'details'],
      ['select', 'choice'],
    ] as const) {
      const control = find(html, tag, 'name', name);
      expect(control.get('aria-invalid'), name).toBe('true');
      expect(textOfId(html, control.get('aria-describedby') ?? ''), name).toBe(
        'form.fieldErrors.missing',
      );
    }
    // The checkbox and the switch had no problem: no error at them.
    expect(find(html, 'button', 'role', 'checkbox').has('aria-invalid')).toBe(false);
    expect(find(html, 'button', 'role', 'switch').has('aria-invalid')).toBe(false);
  });
});
