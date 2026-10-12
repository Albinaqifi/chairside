import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import {
  ClinicDetailsForm,
  type ClinicDetailsChoices,
  type ClinicDetailsValues,
} from './clinic-details-form';

// E01-T08a, acceptance 1 and 2 (the form's side): the Clinic tab's form as the server sends it,
// inside the staff frame, with next-intl's provider as the root layout gives it. useActionState is
// replaced so that a test can choose the form's answer, as in new-patient-form.test.ts. The tester
// uses it in a browser. Every value is synthetic.

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

// The action is server code: the form only hands it to StaffForm.
vi.mock('./actions', () => ({ saveClinicDetails: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000b1';

const VALUES: ClinicDetailsValues = {
  name: 'Lakeside Dental',
  phone: '070 001 234',
  address: 'Ulica 1, Skopje',
  email: 'desk@example.test',
  timeZone: 'Europe/Skopje',
  locale: 'en',
  currency: 'MKD',
  country: 'MK',
};

const CHOICES: ClinicDetailsChoices = {
  timeZones: {
    ungrouped: ['UTC'],
    areas: [
      { area: 'America', zones: ['America/New_York'] },
      { area: 'Europe', zones: ['Europe/Kyiv', 'Europe/Skopje'] },
    ],
  },
  languages: [{ value: 'en', label: 'English' }],
  currencies: [
    { value: 'EUR', label: 'Euro (EUR)' },
    { value: 'MKD', label: 'Macedonian Denar (MKD)' },
  ],
  countries: [
    { value: 'MK', label: 'North Macedonia' },
    { value: 'GB', label: 'United Kingdom' },
  ],
};

beforeEach(() => {
  form.state = undefined;
});

/** The form with the answer given, as the server sends it, in a staff frame. */
function renderForm(answer?: FormAnswer<unknown>): string {
  if (answer) form.state = { answer, attempt: 1 };
  const frame: ComponentProps<typeof FrameClinic> = {
    clinicId: CLINIC,
    children: createElement(ClinicDetailsForm, { values: VALUES, choices: CHOICES }),
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

/** The first `tag` element whose attribute `name` is `value`. */
function find(html: string, tag: string, name: string, value: string): Map<string, string> {
  const found = tags(html, tag).find((attributes) => attributes.get(name) === value);
  if (!found) throw new Error(`no ${tag} with ${name}="${value}"`);
  return found;
}

/** The text of the label for the control whose id is `id`, without tags. */
function labelFor(html: string, id: string): string | undefined {
  const match = new RegExp(`<label\\b[^>]*\\bfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html);
  return match?.[1]?.replace(/<[^>]*>/g, '').trim();
}

/** The text of the element whose id is `id`, without tags. */
function textOfId(html: string, id: string): string | undefined {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2]?.replace(/<[^>]*>/g, '').trim();
}

/** The select named `name`, from its tag to its end. */
function selectNamed(html: string, name: string): string {
  const match = new RegExp(`<select\\b[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(
    html,
  );
  if (!match?.[0]) throw new Error(`no select named ${name}`);
  return match[0];
}

/** The values of a select's options, and those of its options chosen. */
function optionsOf(select: string): { values: string[]; chosen: string[] } {
  const options = tags(select, 'option');
  return {
    values: options.map((option) => option.get('value') ?? ''),
    chosen: options.filter((option) => option.has('selected')).map((o) => o.get('value') ?? ''),
  };
}

const t = messages.settings.clinic;

describe("the Clinic tab's form, as the server sends it (E01-T08a)", () => {
  it('holds one submit button, Save, and no other button', () => {
    const buttons = tags(renderForm(), 'button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.get('type')).toBe('submit');
    expect(renderForm()).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.save}</button>`));
  });

  it('keeps nothing in the browser: autocomplete="off" on its form, and no field asks for it back', () => {
    const html = renderForm();
    expect(tags(html, 'form')[0]?.get('autocomplete')).toBe('off');
    const fields = [...tags(html, 'input'), ...tags(html, 'select')];
    expect(fields).toHaveLength(8);
    for (const field of fields) expect(field.get('autocomplete') ?? 'off').toBe('off');
  });

  it("names each field by its label, under the name its action reads, filled from the clinic's row", () => {
    const html = renderForm();
    for (const [name, label, type, value] of [
      ['name', t.name, undefined, VALUES.name],
      ['phone', t.phone, 'tel', VALUES.phone],
      ['address', t.address, undefined, VALUES.address],
      ['email', t.email, 'email', VALUES.email],
    ] as const) {
      const input = find(html, 'input', 'name', name);
      expect(labelFor(html, input.get('id') ?? ''), name).toBe(label);
      expect(input.get('type'), name).toBe(type);
      expect(input.get('value'), name).toBe(value);
    }
    for (const [name, label] of [
      ['timeZone', t.timeZone],
      ['locale', t.language],
      ['currency', t.currency],
      ['country', t.country],
    ] as const) {
      const select = find(html, 'select', 'name', name);
      expect(labelFor(html, select.get('id') ?? ''), name).toBe(label);
    }
  });

  it('each select offers its choices, the stored one chosen', () => {
    const html = renderForm();
    expect(optionsOf(selectNamed(html, 'locale'))).toEqual({ values: ['en'], chosen: ['en'] });
    expect(optionsOf(selectNamed(html, 'currency'))).toEqual({
      values: ['EUR', 'MKD'],
      chosen: ['MKD'],
    });
    expect(optionsOf(selectNamed(html, 'country'))).toEqual({
      values: ['MK', 'GB'],
      chosen: ['MK'],
    });
    expect(html).toContain('>Macedonian Denar (MKD)</option>');
    expect(html).toContain('>North Macedonia</option>');
  });

  it('the zones: UTC first, then by their areas, the stored one chosen', () => {
    const select = selectNamed(renderForm(), 'timeZone');
    expect(optionsOf(select)).toEqual({
      values: ['UTC', 'America/New_York', 'Europe/Kyiv', 'Europe/Skopje'],
      chosen: ['Europe/Skopje'],
    });
    expect(tags(select, 'optgroup').map((group) => group.get('label'))).toEqual([
      'America',
      'Europe',
    ]);
    expect(select.indexOf('value="UTC"')).toBeLessThan(select.indexOf('<optgroup'));
  });

  it('says under the zone and under the phone country what each is for, read with its select', () => {
    const html = renderForm();
    for (const [name, hint] of [
      ['timeZone', t.timeZoneHint],
      ['country', t.countryHint],
    ] as const) {
      const select = find(html, 'select', 'name', name);
      expect(textOfId(html, select.get('aria-describedby') ?? ''), name).toBe(hint);
    }
    expect(t.countryHint).toMatch(/without \+ and its country code/);
  });

  it('with a problem at the phone country: the problem read first, then the line', () => {
    const html = renderForm({ kind: 'invalid', fields: new Map([['country', 'other']]) });
    const country = find(html, 'select', 'name', 'country');
    expect(country.get('aria-invalid')).toBe('true');
    const [problem, line] = (country.get('aria-describedby') ?? '').split(' ');
    expect(textOfId(html, problem ?? '')).toBe(messages.form.fieldErrors.other);
    expect(textOfId(html, line ?? '')).toBe(t.countryHint);
  });

  it('an impossible phone: at its field, as every staff form shows a problem (D-098)', () => {
    const html = renderForm({ kind: 'invalid', fields: new Map([['phone', 'invalidFormat']]) });
    const phone = find(html, 'input', 'name', 'phone');
    expect(phone.get('aria-invalid')).toBe('true');
    expect(textOfId(html, phone.get('aria-describedby') ?? '')).toBe(
      messages.form.fieldErrors.invalidFormat,
    );
  });

  it('a zone the database does not know: a message above the button that names the time zone', () => {
    const html = renderForm({ kind: 'refused', code: 'time_zone_unknown' });
    expect(html).toContain(`role="alert"`);
    expect(html).toContain(t.timeZoneUnknown);
    expect(t.timeZoneUnknown).toMatch(/time zone/);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
    // The select itself is not marked: a refusal shows above the button (D-098).
    expect(find(html, 'select', 'name', 'timeZone').has('aria-invalid')).toBe(false);
  });
});
