import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import { StaffForm } from '@/app/_lib/staff-form';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import { PROVIDER_HUE_MAX, PROVIDER_KINDS, type ClinicProvider } from '@/modules/scheduling';
import { FIRST_HUE, HUE_MAX, hueStyle, KIND_CHOICES } from './provider-fields';
import { ColourField, ProviderFields, Providers } from './providers';

// E01-T09b, acceptance 3 and 4 (the page's side): the Providers tab as the server sends it, inside
// the staff frame, with next-intl's provider as the root layout gives it; and the colour field, whose
// range value is the hue the form sends and whose tints follow it. Dragging the range in a browser,
// and the tints following the drag, is tests/e2e/providers.spec.ts. Every name is an invented one.

// The actions are server code: the tab only hands them to its StaffForm.
vi.mock('./provider-actions', () => ({
  addProvider: vi.fn(),
  readProviders: vi.fn(),
  readLinkedProviders: vi.fn(),
  changeProvider: vi.fn(),
  deactivateProvider: vi.fn(),
  activateProvider: vi.fn(),
}));

const CLINIC = '01970000-0000-7000-8000-0000000000ca';
const FIRST = '01970000-0000-7000-8000-0000000000a1';
const SECOND = '01970000-0000-7000-8000-0000000000a2';
const GONE = '01970000-0000-7000-8000-0000000000a3';

/** As the page hands them: in the calendar's order, an inactive one where its order puts it. */
const PROVIDERS: ClinicProvider[] = [
  {
    id: FIRST,
    name: 'Mira Testova',
    shortName: 'Dr. Testova',
    kind: 'dentist',
    chairLabel: 'Chair 1',
    colorHue: 195,
    active: true,
  },
  {
    id: GONE,
    name: 'Petar Primerov',
    shortName: 'Dr. Primerov',
    kind: 'other',
    chairLabel: 'Chair 3',
    colorHue: 25,
    active: false,
  },
  {
    id: SECOND,
    name: 'Ana Probna',
    shortName: 'Ana',
    kind: 'hygienist',
    chairLabel: 'Hygiene room',
    colorHue: 300,
    active: true,
  },
];

function inFrame(children: ReactElement): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

const renderTab = (providers: readonly ClinicProvider[], linked: readonly string[] = []) =>
  inFrame(createElement(Providers, { providers, linked }));

/** The colour field alone, in a StaffForm as the tab has it, starting at `hue`. */
function renderColour(hue?: number): string {
  const form: ComponentProps<typeof StaffForm> = {
    action: vi.fn(),
    doneMessage: 'done',
    submitLabel: 'Add',
    pendingLabel: 'Adding',
    children: createElement(ColourField, hue === undefined ? {} : { initialHue: hue }),
  };
  return inFrame(createElement(StaffForm, form));
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
    .replace(/\s+/g, ' ');
}

/** The hue each element of this data-slot sets as --provider-hue, in the order of the page. */
function huesOf(html: string, slot: string): string[] {
  return tags(html, '(?:span|div)')
    .filter((element) => element.get('data-slot') === slot)
    .map((element) => /--provider-hue:\s*([^;]*)/.exec(element.get('style') ?? '')?.[1] ?? '');
}

/** Each form, whole, and the html inside it, in the order of the page. */
function forms(html: string): { whole: string; inside: string }[] {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(([whole, inside = '']) => ({
    whole,
    inside,
  }));
}

/** ProviderFields alone, in a StaffForm as the edit dialog has it. */
function renderFields(values: ClinicProvider, kindLocked: boolean): string {
  const form: ComponentProps<typeof StaffForm> = {
    action: vi.fn(),
    doneMessage: 'done',
    submitLabel: 'Save',
    pendingLabel: 'Saving',
    children: createElement(ProviderFields, { values, kindLocked, stacked: true }),
  };
  return inFrame(createElement(StaffForm, form));
}

const t = messages.settings.providers;

describe('the Providers tab, as the server sends it (E01-T09b)', () => {
  it('none yet: the heading, the line saying nothing can be booked, and the add form alone', () => {
    const html = renderTab([]);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${t.heading}</h2>`));
    expect(textOf(html)).toContain(t.none);
    expect(html).not.toContain('<ul');
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.add}</button>`));
  });

  it('each provider in the order handed: its name, short name, kind and chair; an inactive one says so (acceptance 4)', () => {
    const text = textOf(renderTab(PROVIDERS));
    expect(text).toMatch(
      // Each row's buttons after its details since E01-T09d.
      /Mira Testova Dr\. Testova · Dentist · Chair 1 Edit Make inactive Petar Primerov Inactive Dr\. Primerov · Other · Chair 3 Edit Make active Ana Probna Ana · Hygienist · Hygiene room Edit Make inactive/,
    );
    expect(text).not.toContain(t.none);
  });

  // E01-T09d: the rows have their buttons now (E01-T09b's "no button in a row" was the state before
  // this task); what they are is the next describe's.
  it("each row a swatch of its provider's hue, hidden from screen readers", () => {
    const html = renderTab(PROVIDERS);
    // The add form's colour preview has a swatch too, after the rows, at the first hue.
    expect(huesOf(html, 'provider-swatch')).toEqual(['195', '25', '300', String(FIRST_HUE)]);
    const list = /<ul[\s\S]*<\/ul>/.exec(html)?.[0] ?? '';
    expect(
      tags(list, 'span')
        .filter((span) => span.get('data-slot') === 'provider-swatch')
        .every((span) => span.get('aria-hidden') === 'true'),
    ).toBe(true);
  });

  it("the add form: name, short name, the kind as the browser's own select, chair, the colour range; nothing set to be remembered", () => {
    const html = renderTab(PROVIDERS);
    // The last form: the rows' own forms come before it (E01-T09d).
    const add = forms(html).at(-1)?.whole ?? '';
    const inputs = tags(add, 'input');
    expect(inputs.map((input) => input.get('name'))).toEqual([
      'name',
      'shortName',
      'chairLabel',
      'colorHue',
    ]);
    const labels = inputs.map((input) => labelFor(add, input.get('id') ?? ''));
    expect(labels).toEqual([t.name, t.shortName, t.chair, t.colour]);
    for (const input of inputs.slice(0, 3)) expect(input.get('value') ?? '').toBe('');
    const [select] = tags(add, 'select');
    expect(select?.get('name')).toBe('kind');
    expect(labelFor(add, select?.get('id') ?? '')).toBe(t.kind);
    expect(tags(add, 'option').map((option) => option.get('value'))).toEqual([
      'dentist',
      'hygienist',
      'other',
    ]);
    expect(add).toMatch(/<option[^>]*value="dentist" selected="">Dentist<\/option>/);
    // D-093, D-095: the form's own `off`, and no field with an autocomplete of its own.
    expect(tags(add, 'form')[0]?.get('autocomplete')).toBe('off');
    expect([...inputs, select].some((field) => field?.has('autocomplete'))).toBe(false);
  });
});

// E01-T09d: each row's Edit and its Make inactive or Make active, and the edit's fields with the kind
// locked for a provider a login is linked to. What a click does (the dialog, the toast, a double
// click) needs a browser: tests/e2e/providers.spec.ts.
describe("each row's buttons, and the edit's fields (E01-T09d)", () => {
  it('each provider a group named by it, ", inactive" for an inactive one, so its buttons are read with it', () => {
    const groups = tags(renderTab(PROVIDERS), 'div').filter((div) => div.get('role') === 'group');
    expect(groups.map((group) => group.get('aria-label'))).toEqual([
      'Mira Testova',
      'Petar Primerov, inactive',
      'Ana Probna',
    ]);
  });

  it('each row: an Edit that opens a dialog, outside every form, and a form of its own sending the id, hidden: Make inactive, or Make active', () => {
    const html = renderTab(PROVIDERS, [FIRST]);
    const all = forms(html);
    expect(all).toHaveLength(4);
    const expected = [
      [FIRST, t.deactivate],
      [GONE, t.activate],
      [SECOND, t.deactivate],
    ] as const;
    expected.forEach(([id, label], index) => {
      const row = all[index];
      expect(tags(row?.inside ?? '', 'input')).toEqual([
        new Map([
          ['type', 'hidden'],
          ['name', 'providerId'],
          ['value', id],
        ]),
      ]);
      expect(row?.inside).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${label}</button>`));
    });
    const edits = tags(html, 'button').filter((button) => button.get('aria-haspopup') === 'dialog');
    expect(edits).toHaveLength(3);
    expect(edits.every((edit) => edit.get('type') === 'button')).toBe(true);
    // D-093: every form keeps nothing in the browser.
    expect(all.map((form) => tags(form.whole, 'form')[0]?.get('autocomplete'))).toEqual([
      'off',
      'off',
      'off',
      'off',
    ]);
  });

  it("the edit's fields start at the provider's own values; not linked, the kind is a select like the add form's", () => {
    const html = renderFields(PROVIDERS[2]!, false);
    const inputs = tags(html, 'input');
    expect(inputs.map((input) => [input.get('name'), input.get('value')])).toEqual([
      ['name', 'Ana Probna'],
      ['shortName', 'Ana'],
      ['chairLabel', 'Hygiene room'],
      ['colorHue', '300'],
    ]);
    const [select] = tags(html, 'select');
    expect(select?.get('name')).toBe('kind');
    expect(select?.has('disabled')).toBe(false);
    expect(html).toMatch(/<option[^>]*value="hygienist" selected="">Hygienist<\/option>/);
    expect(textOf(html)).not.toContain(t.kindLocked);
    expect(huesOf(html, 'colour-preview')).toEqual(['300']);
  });

  it('linked to a login: the kind shown and disabled, a line under it saying why, read with it; the stored kind sent in a hidden field', () => {
    const html = renderFields(PROVIDERS[0]!, true);
    const [select] = tags(html, 'select');
    expect(select?.has('disabled')).toBe(true);
    expect(html).toMatch(/<option[^>]*value="dentist" selected="">Dentist<\/option>/);
    const hidden = tags(html, 'input').filter((input) => input.get('type') === 'hidden');
    expect(hidden).toEqual([
      new Map([
        ['type', 'hidden'],
        ['name', 'kind'],
        ['value', 'dentist'],
      ]),
    ]);
    const line = tags(html, 'p').find((p) => p.get('id') === select?.get('aria-describedby'));
    expect(line).toBeDefined();
    expect(textOf(html)).toContain(t.kindLocked);
    // The other fields stay open to change.
    expect(tags(html, 'input').filter((input) => input.has('disabled'))).toEqual([]);
  });
});

describe('the colour range (acceptance 3)', () => {
  it('a range of whole hues from 0 to 359, starting at 200, the theme’s own', () => {
    const [range] = tags(renderColour(), 'input');
    expect(range?.get('type')).toBe('range');
    expect(range?.get('name')).toBe('colorHue');
    expect(range?.get('min')).toBe('0');
    expect(range?.get('max')).toBe('359');
    expect(range?.get('step')).toBe('1');
    expect(range?.get('value')).toBe('200');
    expect(FIRST_HUE).toBe(200);
  });

  it.each([0, 37, 200, 359])(
    'at %i: the range’s value is the hue the form sends, and the swatch and the visit’s block show that hue',
    (hue) => {
      const html = renderColour(hue);
      const [range] = tags(html, 'input');
      expect(range?.get('value')).toBe(String(hue));
      expect(huesOf(html, 'colour-preview')).toEqual([String(hue)]);
      expect(huesOf(html, 'provider-swatch')).toEqual([String(hue)]);
      // The block in the theme's four tints, which read the hue set above.
      expect(html).toMatch(
        /class="[^"]*border-provider-edge[^"]*border-l-provider-strong[^"]*bg-provider-tint[^"]*text-provider-ink[^"]*"/,
      );
    },
  );

  it('the preview is seen, not read: hidden from screen readers, the range named by its label', () => {
    const html = renderColour();
    const preview = tags(html, 'div').find((div) => div.get('data-slot') === 'colour-preview');
    expect(preview?.get('aria-hidden')).toBe('true');
    expect(textOf(html)).toContain(t.colourSample);
  });
});

describe("the tab's fields and the scheduling module agree", () => {
  it("the select's kinds are the table's, in its order; the range's end is the table's", () => {
    expect(KIND_CHOICES).toEqual(PROVIDER_KINDS);
    expect(HUE_MAX).toBe(PROVIDER_HUE_MAX);
  });

  it('hueStyle sets --provider-hue, which the theme’s tints read', () => {
    expect(hueStyle(37)).toEqual({ '--provider-hue': '37' });
  });
});
