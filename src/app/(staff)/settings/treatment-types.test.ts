import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { CatalogueType } from '@/modules/scheduling';
import { TreatmentTypes } from './treatment-types';

// E01-T09a, acceptance 1 and 4 (the page's side): the Treatment types tab as the server sends it,
// inside the staff frame, with next-intl's provider as the root layout gives it. As in
// closed-days.test.ts, useActionState is replaced so that a test can choose the answer every form on
// it shows. What a click does (the edit dialog, a double click on Make inactive) needs a browser:
// tests/e2e/treatment-types.spec.ts. Every name is an invented one.

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

// The actions are server code: the tab only hands them to its StaffForms.
vi.mock('./treatment-type-actions', () => ({
  addTreatmentType: vi.fn(),
  changeTreatmentType: vi.fn(),
  deactivateTreatmentType: vi.fn(),
  activateTreatmentType: vi.fn(),
}));

const CLINIC = '01970000-0000-7000-8000-0000000000c9';
const FILLING = '01970000-0000-7000-8000-0000000000e1';
const CHECKUP = '01970000-0000-7000-8000-0000000000e2';
const OLD_CHECKUP = '01970000-0000-7000-8000-0000000000e3';

/** As the page hands them: the active ones by name, then the inactive. */
const TYPES: CatalogueType[] = [
  { id: CHECKUP, name: 'Checkup', minutes: 30, price: null, needsAftercare: false, active: true },
  { id: FILLING, name: 'Filling', minutes: 45, price: 150000, needsAftercare: true, active: true },
  {
    id: OLD_CHECKUP,
    name: 'Checkup',
    minutes: 7,
    price: 1250,
    needsAftercare: false,
    active: false,
  },
];

beforeEach(() => {
  form.state = undefined;
});

function renderTab(
  types: readonly CatalogueType[],
  answer?: FormAnswer<unknown>,
  currency = 'MKD',
): string {
  if (answer) form.state = { answer, attempt: 1 };
  const frame: ComponentProps<typeof FrameClinic> = {
    clinicId: CLINIC,
    children: createElement(TreatmentTypes, { types, currency }),
  };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** The text of the label for the control whose id is `id`, without tags. */
function labelFor(html: string, id: string): string | undefined {
  const match = new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html);
  return match?.[1]
    ?.replace(/<!-- -->/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/** The page's text, without tags, as a screen shows it. */
function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s+/g, ' ');
}

/** Each form's attributes and the html inside it, in the order of the page. */
function forms(html: string): { attributes: Map<string, string>; inside: string }[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([whole, , inside = '']) => ({
    attributes: tags(whole, 'form')[0] ?? new Map<string, string>(),
    inside,
  }));
}

const t = messages.settings.treatmentTypes;

describe('the Treatment types tab, as the server sends it (E01-T09a)', () => {
  it('none yet: the heading, the line saying nothing can be booked, and the add form alone', () => {
    const html = renderTab([]);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${t.heading}</h2>`));
    expect(textOf(html)).toContain(t.none);
    expect(html).not.toContain('<ul');
    expect(forms(html)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.add}</button>`));
  });

  it('each type: its name, its length, its price in the clinic currency, "Needs aftercare"; an inactive one says so', () => {
    const text = textOf(renderTab(TYPES));
    expect(text).toContain('Checkup 30 min');
    expect(text).toMatch(/Filling 45 min · MKD 1,500\.00 · Needs aftercare/);
    expect(text).toMatch(/Checkup Inactive 7 min · MKD 12\.50/);
    expect(text).not.toContain(t.none);
  });

  it('a price in a currency without decimals is shown whole', () => {
    const text = textOf(renderTab(TYPES.slice(1, 2), undefined, 'JPY'));
    expect(text).toMatch(/¥150,000/);
  });

  it('each type a group named by it, ", inactive" for an inactive one, so its buttons are read with it', () => {
    const groups = tags(renderTab(TYPES), 'div').filter((div) => div.get('role') === 'group');
    expect(groups.map((group) => group.get('aria-label'))).toEqual([
      'Checkup',
      'Filling',
      'Checkup, inactive',
    ]);
  });

  it('each row: an Edit that opens a dialog, and a form of its own sending the id, hidden: Make inactive, or Make active', () => {
    const html = renderTab(TYPES);
    const all = forms(html);
    expect(all).toHaveLength(4);
    const expected = [
      [CHECKUP, t.deactivate],
      [FILLING, t.deactivate],
      [OLD_CHECKUP, t.activate],
    ] as const;
    expected.forEach(([id, label], index) => {
      const row = all[index];
      expect(tags(row?.inside ?? '', 'input')).toEqual([
        new Map([
          ['type', 'hidden'],
          ['name', 'treatmentTypeId'],
          ['value', id],
        ]),
      ]);
      expect(row?.inside).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${label}</button>`));
    });
    const edits = tags(html, 'button').filter((button) => button.get('aria-haspopup') === 'dialog');
    expect(edits).toHaveLength(3);
    // Outside every form: an Edit is no submit button of a row's form.
    expect(edits.every((edit) => edit.get('type') === 'button')).toBe(true);
  });

  it("the add form: the name, the length as the browser's own select from 5 to 240 minutes (30 first), the price in the currency, the checkbox", () => {
    const html = renderTab(TYPES);
    const add = forms(html).at(-1)?.inside ?? '';
    const [name, price] = tags(add, 'input').filter((input) => input.get('type') !== 'checkbox');
    expect(name?.get('name')).toBe('name');
    expect(labelFor(add, name?.get('id') ?? '')).toBe(t.name);
    expect(name?.get('value') ?? '').toBe('');
    expect(price?.get('value') ?? '').toBe('');
    const [select] = tags(add, 'select');
    expect(select?.get('name')).toBe('minutes');
    expect(labelFor(add, select?.get('id') ?? '')).toBe(t.length);
    const options = tags(add, 'option').map((option) => option.get('value'));
    expect(options[0]).toBe('5');
    expect(options.at(-1)).toBe('240');
    expect(options).toHaveLength(48);
    expect(add).toMatch(/<option[^>]*value="30" selected="">30 minutes<\/option>/);
    expect(price?.get('name')).toBe('price');
    expect(price?.get('inputmode')).toBe('decimal');
    expect(labelFor(add, price?.get('id') ?? '')).toBe('Price in MKD (optional)');
    // Radix's checkbox: a button, and its label beside it.
    const box = tags(add, 'button').find((button) => button.get('role') === 'checkbox');
    expect(box?.get('aria-checked')).toBe('false');
    expect(labelFor(add, box?.get('id') ?? '')).toBe(t.needsAftercare);
  });

  it('keeps nothing in the browser: autocomplete="off" on every form, and no field asks for it back', () => {
    const html = renderTab(TYPES);
    expect(forms(html).map((f) => f.attributes.get('autocomplete'))).toEqual([
      'off',
      'off',
      'off',
      'off',
    ]);
    for (const field of [...tags(html, 'input'), ...tags(html, 'select')]) {
      expect(field.get('autocomplete') ?? 'off').toBe('off');
    }
  });

  it("the add form's refusals, above its button, each naming the field: the name, the price's decimals in the currency, a price too high", () => {
    for (const [code, text, field] of [
      ['name_taken', t.nameTaken, /name/i],
      ['price_decimals', t.priceDecimals.replace('{currency}', 'JPY'), /price/i],
      ['price_too_high', t.priceTooHigh, /price/i],
    ] as const) {
      const html = renderTab([], { kind: 'refused', code }, 'JPY');
      expect(html, code).toMatch(new RegExp(`<p role="alert"[^>]*>${text}</p>`));
      expect(text, code).toMatch(field);
    }
  });

  it("a row's refusals, above its own button: a type gone, one changed meanwhile, a name an active one has", () => {
    let html = renderTab(TYPES.slice(0, 1), { kind: 'refused', code: 'already_inactive' });
    expect(forms(html)[0]?.inside).toMatch(
      new RegExp(`<p role="alert"[^>]*>${t.alreadyInactive}</p>`),
    );
    html = renderTab(TYPES.slice(2), { kind: 'refused', code: 'name_taken' });
    expect(forms(html)[0]?.inside).toMatch(
      new RegExp(`<p role="alert"[^>]*>${t.activeNameTaken}</p>`),
    );
    html = renderTab(TYPES.slice(2), { kind: 'refused', code: 'not_found' });
    expect(forms(html)[0]?.inside).toMatch(new RegExp(`<p role="alert"[^>]*>${t.notFound}</p>`));
  });
});
