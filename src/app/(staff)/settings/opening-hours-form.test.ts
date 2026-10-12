import { createFormatter, NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { weekValues } from './opening-hours';
import { OpeningHoursForm } from './opening-hours-form';

// E01-T08b, acceptance 1 (the form's side): the Opening hours tab's form as the server sends it,
// inside the staff frame, with next-intl's provider as the root layout gives it. useActionState is
// replaced so that a test can choose the form's answer, as in clinic-details-form.test.ts. The tester
// uses it in a browser. No test pins how a time reads ("8:00 AM" or "08:00": E01-T04b's clock); each
// asserts an option's value, and that its label is the formatter's.

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
vi.mock('./actions', () => ({ saveOpeningHours: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000b4';

/** Monday to Friday 08:00–18:00 but Wednesday 08:10–20:00, the weekend closed. */
const WEEK = weekValues([
  { weekday: 1, opens: 480, closes: 1080 },
  { weekday: 2, opens: 480, closes: 1080 },
  { weekday: 3, opens: 490, closes: 1200 },
  { weekday: 4, opens: 480, closes: 1080 },
  { weekday: 5, opens: 480, closes: 1080 },
]);

beforeEach(() => {
  form.state = undefined;
});

/** The form with the answer given, as the server sends it, in a staff frame. */
function renderForm(answer?: FormAnswer<unknown>): string {
  if (answer) form.state = { answer, attempt: 1 };
  const frame: ComponentProps<typeof FrameClinic> = {
    clinicId: CLINIC,
    children: createElement(OpeningHoursForm, { week: WEEK }),
  };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: 'en',
    messages,
    timeZone: 'Pacific/Auckland',
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
  return match?.[1]?.replace(/<[^>]*>/g, '').trim();
}

/** The text of the element whose id is `id`, without tags. */
function textOfId(html: string, id: string): string | undefined {
  const match = new RegExp(`<(\\w+)[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2]?.replace(/<[^>]*>/g, '').trim();
}

/** The select named `name`: its own attributes, and its options' values, texts and the one chosen. */
function selectNamed(html: string, name: string) {
  const match = new RegExp(`<select\\b[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(
    html,
  );
  if (!match?.[0]) throw new Error(`no select named ${name}`);
  const options = [...(match[1] ?? '').matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
  return {
    attributes: tags(match[0], 'select')[0] ?? new Map<string, string>(),
    values: options.map(([, inside = '']) => /value="([^"]*)"/.exec(inside)?.[1] ?? ''),
    texts: Object.fromEntries(
      options.map(([, inside = '', text = '']) => [/value="([^"]*)"/.exec(inside)?.[1], text]),
    ),
    chosen: options
      .filter(([, inside = '']) => /\bselected\b/.test(inside))
      .map(([, inside = '']) => /value="([^"]*)"/.exec(inside)?.[1]),
  };
}

const t = messages.settings.hours;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

describe("the Opening hours tab's form, as the server sends it (E01-T08b)", () => {
  it('holds one submit button, Save; the switches are buttons that never send the form', () => {
    const buttons = tags(renderForm(), 'button');
    expect(buttons.filter((button) => button.get('type') === 'submit')).toHaveLength(1);
    expect(buttons.filter((button) => button.get('role') === 'switch')).toHaveLength(7);
    expect(buttons.every((b) => b.get('type') === 'submit' || b.get('type') === 'button')).toBe(
      true,
    );
    expect(renderForm()).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.save}</button>`));
  });

  it('keeps nothing in the browser: autocomplete="off" on its form, and no field asks for it back', () => {
    const html = renderForm();
    expect(tags(html, 'form')[0]?.get('autocomplete')).toBe('off');
    const fields = [...tags(html, 'input'), ...tags(html, 'select')];
    expect(fields).toHaveLength(21); // a switch's hidden checkbox and two selects a weekday
    for (const field of fields) expect(field.get('autocomplete') ?? 'off').toBe('off');
  });

  it('each switch sends its weekday\'s field, mondayOpen…, as "on" when open, nothing when closed', () => {
    const checkboxes = tags(renderForm(), 'input');
    expect(checkboxes.map((input) => input.get('name'))).toEqual(
      DAYS.map((day) => `${day.toLowerCase()}Open`),
    );
    expect(checkboxes.map((input) => input.get('type'))).toEqual(Array(7).fill('checkbox'));
    expect(checkboxes.map((input) => input.get('value'))).toEqual(Array(7).fill('on'));
    expect(checkboxes.map((input) => input.has('checked'))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('each weekday, Monday first, a group named by it: its switch named by the weekday, then Opens and Closes', () => {
    const html = renderForm();
    expect(tags(html, 'div').flatMap((div) => div.get('aria-label') ?? [])).toEqual(DAYS);
    const switches = tags(html, 'button').filter((button) => button.get('role') === 'switch');
    expect(switches.map((s) => labelFor(html, s.get('id') ?? ''))).toEqual(DAYS);
    for (const day of ['monday', 'sunday']) {
      expect(labelFor(html, selectNamed(html, `${day}Opens`).attributes.get('id') ?? '')).toBe(
        t.opens,
      );
      expect(labelFor(html, selectNamed(html, `${day}Closes`).attributes.get('id') ?? '')).toBe(
        t.closes,
      );
    }
    expect(html).toContain(t.intro);
  });

  it('an open weekday: its switch on, its times chosen, every 15 minutes from 00:00 to 23:45 offered', () => {
    const html = renderForm();
    const monday = tags(html, 'button').find((b) => b.get('role') === 'switch');
    expect(monday?.get('aria-checked')).toBe('true');
    const opens = selectNamed(html, 'mondayOpens');
    expect(opens.attributes.has('disabled')).toBe(false);
    expect(opens.values).toHaveLength(96);
    expect(opens.values.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
    expect(opens.values.at(-1)).toBe('23:45');
    expect(opens.chosen).toEqual(['08:00']);
    expect(selectNamed(html, 'mondayCloses').chosen).toEqual(['18:00']);
    expect(opens.values).not.toContain('');
  });

  it('a stored time the steps lack (08:10) is offered as it is, and chosen', () => {
    const opens = selectNamed(renderForm(), 'wednesdayOpens');
    expect(opens.values).toHaveLength(97);
    expect(opens.values.slice(32, 35)).toEqual(['08:00', '08:10', '08:15']);
    expect(opens.chosen).toEqual(['08:10']);
  });

  it('a closed weekday: its switch off, its selects disabled on "Not set", so the browser sends neither', () => {
    const html = renderForm();
    const sunday = tags(html, 'button').filter((b) => b.get('role') === 'switch')[6];
    expect(sunday?.get('aria-checked')).toBe('false');
    for (const name of ['sundayOpens', 'sundayCloses', 'saturdayOpens']) {
      const select = selectNamed(html, name);
      expect(select.attributes.has('disabled'), name).toBe(true);
      expect(select.values[0], name).toBe('');
      expect(select.texts[''], name).toBe(t.noTime);
      expect(select.chosen, name).toEqual(['']);
    }
  });

  it("each time's label is the formatter's, in UTC: no zone moves a time of the clinic's clock", () => {
    const opens = selectNamed(renderForm(), 'wednesdayOpens');
    const format = createFormatter({ locale: 'en', timeZone: 'Pacific/Auckland' });
    const label = (hours: number, minutes: number) =>
      format.dateTime(new Date(Date.UTC(2000, 0, 1, hours, minutes)), {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      });
    expect(opens.texts['08:00']).toBe(label(8, 0));
    expect(opens.texts['08:10']).toBe(label(8, 10));
    expect(opens.texts['13:45']).toBe(label(13, 45));
    expect(opens.texts['00:00']).toBe(label(0, 0));
  });

  it('a problem at a time: at its field, as every staff form shows one (D-098)', () => {
    const html = renderForm({
      kind: 'invalid',
      fields: new Map([
        ['mondayOpens', 'missing'],
        ['tuesdayCloses', 'other'],
      ]),
    });
    const opens = selectNamed(html, 'mondayOpens').attributes;
    expect(opens.get('aria-invalid')).toBe('true');
    expect(textOfId(html, opens.get('aria-describedby') ?? '')).toBe(
      messages.form.fieldErrors.missing,
    );
    const closes = selectNamed(html, 'tuesdayCloses').attributes;
    expect(textOfId(html, closes.get('aria-describedby') ?? '')).toBe(
      messages.form.fieldErrors.other,
    );
    expect(selectNamed(html, 'mondayCloses').attributes.has('aria-invalid')).toBe(false);
  });
});
