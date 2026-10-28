import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { ClinicBreak, ClinicProvider } from '@/modules/scheduling';
import { BreaksPanel } from './provider-breaks';

// E01-T09e, the dialog's side: the Breaks dialog's content as the server would send it, inside the
// staff frame with next-intl's provider as the root layout gives it (the dialog mounts its content only
// while it is open, so BreaksPanel is rendered on its own). What a click does (the dialog, the toast,
// a double click on Remove) needs a browser: tests/e2e/provider-breaks.spec.ts. Every name is invented.

// The actions are server code: the dialog only hands them to its StaffForms.
vi.mock('./provider-actions', () => ({ addBreak: vi.fn(), removeBreak: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000b0';
const PROVIDER_ID = '01970000-0000-7000-8000-0000000000b1';
const MONDAY_LUNCH = '01970000-0000-7000-8000-0000000000b2';
const WEDNESDAY_TEA = '01970000-0000-7000-8000-0000000000b3';

const PROVIDER: ClinicProvider = {
  id: PROVIDER_ID,
  name: 'Mira Testova',
  shortName: 'Dr. Testova',
  kind: 'dentist',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};

const BREAKS: ClinicBreak[] = [
  {
    id: MONDAY_LUNCH,
    providerId: PROVIDER_ID,
    weekday: 1,
    starts: '12:00',
    ends: '13:00',
    label: 'Lunch',
  },
  {
    id: WEDNESDAY_TEA,
    providerId: PROVIDER_ID,
    weekday: 3,
    starts: '15:30',
    ends: '15:45',
    label: 'Tea',
  },
];

function inFrame(children: ReactElement, timeZone = 'Europe/Skopje'): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone,
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

const render = (breaks: readonly ClinicBreak[], timeZone?: string) =>
  inFrame(createElement(BreaksPanel, { provider: PROVIDER, breaks }), timeZone);

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

/** Each form, whole, and the html inside it, in the order of the page. */
function forms(html: string): { whole: string; inside: string }[] {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(([whole, inside = '']) => ({
    whole,
    inside,
  }));
}

const t = messages.settings.providers;

describe("the Breaks dialog's content (E01-T09e)", () => {
  it('none yet: the heading, the line saying so, and the add form alone', () => {
    const html = render([]);
    expect(html).toMatch(new RegExp(`<h3[^>]*>${t.breaksHeading}</h3>`));
    expect(textOf(html)).toContain(t.breaksNone);
    expect(html).not.toContain('<ul');
    expect(forms(html)).toHaveLength(1);
  });

  it('each break in the order handed: its weekday, its times on the 24-hour clock and its label; a group named by all three, with its own Remove', () => {
    const html = render(BREAKS);
    const text = textOf(html);
    expect(text).toContain('Monday · 12:00–13:00 Lunch');
    expect(text).toContain('Wednesday · 15:30–15:45 Tea');
    expect(text).not.toContain(t.breaksNone);
    const groups = tags(html, 'div').filter((div) => div.get('role') === 'group');
    expect(groups.map((group) => group.get('aria-label'))).toEqual([
      'Monday, 12:00–13:00, Lunch',
      'Wednesday, 15:30–15:45, Tea',
    ]);
  });

  // A weekday and a time are no moments: the clinic's zone moves neither (CLAUDE.md, dates and times).
  // Named zones, never the computer's: one far behind UTC, where a date would show the day before,
  // and one far ahead.
  it.each(['Pacific/Pago_Pago', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    'the weekday and the times read the same in %s',
    (zone) => {
      const text = textOf(render(BREAKS, zone));
      expect(text).toContain('Monday · 12:00–13:00 Lunch');
      expect(text).toContain('Wednesday · 15:30–15:45 Tea');
    },
  );

  it("a Remove is a form of its own sending the break's id, hidden, and nothing remembered; the add form is outside every row", () => {
    const all = forms(render(BREAKS));
    expect(all).toHaveLength(3);
    [MONDAY_LUNCH, WEDNESDAY_TEA].forEach((id, index) => {
      const row = all[index];
      expect(tags(row?.inside ?? '', 'input')).toEqual([
        new Map([
          ['type', 'hidden'],
          ['name', 'breakId'],
          ['value', id],
        ]),
      ]);
      expect(row?.inside).toMatch(
        new RegExp(`<button[^>]*type="submit"[^>]*>${t.breakRemove}</button>`),
      );
    });
    // D-093: every form keeps nothing in the browser.
    expect(all.map((form) => tags(form.whole, 'form')[0]?.get('autocomplete'))).toEqual(
      all.map(() => 'off'),
    );
  });

  it("the add form: the provider hidden; weekday, start and end as the browser's own selects, Monday first, the start at 12:00 and the end at 13:00; a label; one submit button", () => {
    const html = render(BREAKS);
    const add = forms(html).at(-1)?.whole ?? '';
    const inputs = tags(add, 'input');
    expect(inputs.map((input) => [input.get('type') ?? 'text', input.get('name')])).toEqual([
      ['hidden', 'providerId'],
      ['text', 'label'],
    ]);
    expect(inputs[0]?.get('value')).toBe(PROVIDER_ID);
    expect(labelFor(add, inputs[1]?.get('id') ?? '')).toBe(t.breakLabel);
    const selects = tags(add, 'select');
    expect(selects.map((select) => select.get('name'))).toEqual(['weekday', 'starts', 'ends']);
    expect(selects.map((select) => labelFor(add, select.get('id') ?? ''))).toEqual([
      t.breakWeekday,
      t.breakStarts,
      t.breakEnds,
    ]);
    const options = [...add.matchAll(/<select\b[\s\S]*?<\/select>/g)].map(([select]) =>
      [...select.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(
        ([, attributes = '', text]) => ({
          value: /value="([^"]*)"/.exec(attributes)?.[1],
          selected: attributes.includes('selected'),
          text,
        }),
      ),
    );
    expect(options[0]?.map((option) => option.text)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(options[0]?.map((option) => option.value)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(options[0]?.find((option) => option.selected)?.value).toBe('1');
    // Fifteen-minute steps on the 24-hour clock, 00:00 to 23:45.
    for (const times of [options[1], options[2]]) {
      expect(times).toHaveLength(96);
      expect(times?.[0]).toMatchObject({ value: '00:00', text: '00:00' });
      expect(times?.at(-1)).toMatchObject({ value: '23:45', text: '23:45' });
    }
    expect(options[1]?.find((option) => option.selected)?.value).toBe('12:00');
    expect(options[2]?.find((option) => option.selected)?.value).toBe('13:00');
    expect(add.match(/type="submit"/g)).toHaveLength(1);
    expect(add).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${t.breakAdd}</button>`));
    // D-093, D-095: no field with an autocomplete of its own.
    expect([...inputs, ...selects].some((field) => field.has('autocomplete'))).toBe(false);
  });
});
