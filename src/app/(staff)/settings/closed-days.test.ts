import { createFormatter, NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { ClosedDay } from '@/modules/tenancy';
import { ClosedDays } from './closed-days';

// E01-T08c, acceptance 1 and 5 (the page's side): the Opening hours tab's closed days as the server
// sends them, inside the staff frame, with next-intl's provider as the root layout gives it. As in
// opening-hours-form.test.ts, useActionState is replaced so that a test can choose the answer every
// form on it shows. What a click does (the add form emptied, the keyboard's place) needs a browser:
// the tester's, and the builder's by hand (handoffs/E01-T08c.md).

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

// The actions are server code: the section only hands them to its StaffForms.
vi.mock('./actions', () => ({ addClosedDay: vi.fn(), removeClosedDay: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000c8';

/** A Wednesday and a Friday ahead, as the page hands them: by date. */
const DAYS: ClosedDay[] = [
  { date: '2026-10-14', label: 'Closed for training' },
  { date: '2026-12-25', label: 'Christmas Day' },
];

beforeEach(() => {
  form.state = undefined;
});

/**
 * The section with these days and the answer given, as the server sends it, in a staff frame, under
 * the clinic's zone (one far ahead of UTC unless a test names another).
 */
function renderSection(
  days: readonly ClosedDay[],
  answer?: FormAnswer<unknown>,
  timeZone = 'Pacific/Auckland',
): string {
  if (answer) form.state = { answer, attempt: 1 };
  const frame: ComponentProps<typeof FrameClinic> = {
    clinicId: CLINIC,
    children: createElement(ClosedDays, { days }),
  };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone,
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

/** The page's text, without tags, as a screen shows it (React's comments between texts gone). */
function textOf(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Each form's attributes and the html inside it, in the order of the page. */
function forms(html: string): { attributes: Map<string, string>; inside: string }[] {
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([whole, , inside = '']) => ({
    attributes: tags(whole, 'form')[0] ?? new Map<string, string>(),
    inside,
  }));
}

const t = messages.settings.hours.closedDays;

describe("the Opening hours tab's closed days, as the server sends them (E01-T08c)", () => {
  it('none ahead: the heading, the line on what a closed day does, one line saying so, and the add form alone', () => {
    const html = renderSection([]);
    expect(html).toMatch(new RegExp(`<h2[^>]*>${t.heading}</h2>`));
    expect(html).toContain(t.intro);
    expect(textOf(html)).toContain(t.none);
    expect(html).not.toContain('<ul');
    expect(forms(html)).toHaveLength(1);
    const buttons = tags(html, 'button');
    expect(buttons.map((button) => button.get('type'))).toEqual(['submit']);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.add}</button>`));
  });

  it('its line says what a closed day does today, the calendar, and nothing about messages (E02, E03-T06)', () => {
    expect(t.intro).toMatch(/calendar/i);
    expect(t.intro).not.toMatch(/messag|remind|whatsapp|e-?mail|sms|quiet/i);
  });

  it('each day ahead: its date, its label, and a Remove of its own sending that date, hidden', () => {
    const html = renderSection(DAYS);
    expect(textOf(html)).not.toContain(t.none);
    const text = textOf(html);
    expect(text).toContain('Wednesday, October 14, 2026 Closed for training');
    expect(text).toContain('Friday, December 25, 2026 Christmas Day');
    // A form for each day, then the add form.
    const [first, second, add] = forms(html);
    expect(forms(html)).toHaveLength(3);
    for (const [remove, date] of [
      [first, '2026-10-14'],
      [second, '2026-12-25'],
    ] as const) {
      const inputs = tags(remove?.inside ?? '', 'input');
      expect(inputs).toEqual([
        new Map([
          ['type', 'hidden'],
          ['name', 'date'],
          ['value', date],
        ]),
      ]);
      expect(remove?.inside).toMatch(
        new RegExp(`<button[^>]*type="submit"[^>]*>${t.remove}</button>`),
      );
    }
    expect(add?.inside).toContain(t.add);
  });

  it('each day a group named by its date, so its Remove is read with the day it removes', () => {
    const html = renderSection(DAYS);
    const groups = tags(html, 'div').filter((div) => div.get('role') === 'group');
    expect(groups.map((group) => group.get('aria-label'))).toEqual([
      'Wednesday, October 14, 2026',
      'Friday, December 25, 2026',
    ]);
  });

  it("the add form: the browser's own date field labelled Date, a text field labelled Label", () => {
    const html = renderSection(DAYS);
    const add = forms(html).at(-1)?.inside ?? '';
    const [date, label] = tags(add, 'input');
    expect(date?.get('type')).toBe('date');
    expect(date?.get('name')).toBe('date');
    expect(labelFor(add, date?.get('id') ?? '')).toBe(t.date);
    expect(label?.get('type')).toBeUndefined();
    expect(label?.get('name')).toBe('label');
    expect(labelFor(add, label?.get('id') ?? '')).toBe(t.label);
    // Empty: nothing typed before, nothing the page fills in.
    expect(date?.has('value')).toBe(false);
    expect(label?.has('value')).toBe(false);
  });

  it('keeps nothing in the browser: autocomplete="off" on every form, and no field asks for it back', () => {
    const html = renderSection(DAYS);
    const all = forms(html);
    expect(all.map((f) => f.attributes.get('autocomplete'))).toEqual(['off', 'off', 'off']);
    for (const field of tags(html, 'input')) expect(field.get('autocomplete') ?? 'off').toBe('off');
  });

  // CLAUDE.md, "Dates and times": a calendar date is formatted in UTC, and tested in a zone behind UTC,
  // where midnight UTC of the 14th is still the 13th.
  it.each(['America/New_York', 'Pacific/Pago_Pago', 'Pacific/Kiritimati'])(
    'in a clinic zone of %s: each day on its own date, never the day before or after',
    (timeZone) => {
      const local = createFormatter({ locale: LOCALE, timeZone });
      const html = renderSection(DAYS, undefined, timeZone);
      const text = textOf(html);
      expect(text).toContain('Wednesday, October 14, 2026');
      expect(text).toContain('Friday, December 25, 2026');
      const zoneAlone = local.dateTime(new Date('2026-10-14'), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      if (zoneAlone !== 'Wednesday, October 14, 2026') expect(text).not.toContain(zoneAlone);
    },
  );

  it("the add form's refusals, above its button, name the date and never repeat it", () => {
    for (const [code, text] of [
      ['already_closed', t.alreadyClosed],
      ['in_the_past', t.inThePast],
    ] as const) {
      const html = renderSection([], { kind: 'refused', code });
      expect(html, code).toMatch(new RegExp(`<p role="alert"[^>]*>${text}</p>`));
      expect(text, code).toMatch(/date/i);
    }
  });

  it("a Remove's refusals, above its own button: a day no longer closed, a day past", () => {
    let html = renderSection(DAYS.slice(0, 1), { kind: 'refused', code: 'not_closed' });
    const [remove, add] = forms(html);
    expect(remove?.inside).toMatch(new RegExp(`<p role="alert"[^>]*>${t.notClosed}</p>`));
    // The add form has no text for it: the general failure.
    expect(add?.inside).toContain(messages.form.failed);
    html = renderSection(DAYS.slice(0, 1), { kind: 'refused', code: 'in_the_past' });
    expect(forms(html)[0]?.inside).toMatch(new RegExp(`<p role="alert"[^>]*>${t.removePast}</p>`));
  });

  it('a problem at the date or the label: at its field, as every staff form shows one (D-098)', () => {
    const html = renderSection([], {
      kind: 'invalid',
      fields: new Map([
        ['date', 'missing'],
        ['label', 'tooBig'],
      ]),
    });
    const [date, label] = tags(html, 'input');
    expect(date?.get('aria-invalid')).toBe('true');
    expect(textOfId(html, date?.get('aria-describedby') ?? '')).toBe(
      messages.form.fieldErrors.missing,
    );
    expect(textOfId(html, label?.get('aria-describedby') ?? '')).toBe(
      messages.form.fieldErrors.tooBig,
    );
  });
});
