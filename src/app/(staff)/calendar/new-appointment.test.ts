import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { TreatmentType } from '@/modules/scheduling';
import { startChoices, type BookingChoices } from './booking-choices';
import { BookingForm, NewAppointment, type Booking } from './new-appointment';
import { layoutDay } from './day';

// E01-T05a, acceptance 5 (the message), 6 and 8: the booking form of the new-appointment drawer as the
// server renders it, inside the staff frame, with next-intl's provider as the root layout gives it:
// the message file and the clinic's zone. The drawer opens in a portal, which renders nothing on the
// server: its form is rendered here on its own. useActionState is replaced so that a test can choose
// the form's answer, as in new-patient-form.test.ts. Clicks and keys are in tests/e2e/booking.spec.ts.
// Names are from the seed's invented lists; ids are made up.

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

// The actions are server code: the form only hands them to StaffForm and the search.
vi.mock('./actions', () => ({ bookAppointment: vi.fn(), readCalendarDay: vi.fn() }));
vi.mock('../patients/actions', () => ({ searchPatients: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000f5';
const H = 60;
const DENTIST = '01970000-0000-7000-8000-0000000004a1';
const HYGIENIST = '01970000-0000-7000-8000-0000000004b2';
const CHECKUP: TreatmentType = {
  id: '01970000-0000-7000-8000-000000000601',
  name: 'Checkup',
  minutes: 30,
};
const IMPLANT: TreatmentType = {
  id: '01970000-0000-7000-8000-000000000602',
  name: 'Implant review',
  minutes: 50,
};

const CHOICES: BookingChoices = {
  day: '2026-10-26',
  today: '2026-10-26',
  starts: startChoices({ from: 8 * H, to: 18 * H }),
  firstStart: 9 * H,
  providers: [
    { id: DENTIST, shortName: 'Dr. Planinska' },
    { id: HYGIENIST, shortName: 'Lumi' },
  ],
  firstProviderId: DENTIST,
  treatmentTypes: [CHECKUP, IMPLANT],
};

const FIRST: Booking = {
  patient: null,
  treatmentId: null,
  start: 9 * H,
  length: 30,
  providerId: DENTIST,
};

beforeEach(() => {
  form.state = undefined;
});

/** What the server sends for the form, in a staff frame, in Skopje. */
function render(
  booking: Partial<Booking> = {},
  options: { choices?: Partial<BookingChoices>; answer?: FormAnswer<unknown> } = {},
): string {
  if (options.answer) form.state = { answer: options.answer, attempt: 1 };
  const element = createElement(BookingForm, {
    choices: { ...CHOICES, ...options.choices },
    booking: { ...FIRST, ...booking },
    onChange: vi.fn(),
    listOpen: false,
    onListOpen: vi.fn(),
    onDone: vi.fn(),
  });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
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

/** The text of `html` without its tags, with the entities React writes read. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Each `option` of the select named `name`: its value, its text, and whether it is chosen. */
function optionsOf(html: string, name: string): { value: string; text: string; chosen: boolean }[] {
  const select = new RegExp(`<select\\b[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (!select) throw new Error(`no select named ${name}`);
  return [...(select[1] ?? '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(
    ([, attributes = '', inside = '']) => ({
      value: /value="([^"]*)"/.exec(attributes)?.[1] ?? '',
      text: text(inside),
      chosen: /\sselected=""/.test(attributes),
    }),
  );
}

/** The submit button's text. */
function bookText(html: string): string {
  const button = /<button\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  return text(button?.[1] ?? '');
}

describe('the fields the booking sends, and nothing typed kept in the browser (acceptance 8)', () => {
  it('the form keeps nothing; its fields are the patient picked, the treatment, start, length, provider and day', () => {
    const html = render();
    expect(tags(html, 'form')[0]?.get('autocomplete')).toBe('off');
    const named = [...tags(html, 'input'), ...tags(html, 'select')]
      .map((field) => field.get('name'))
      .filter((name) => name !== undefined);
    expect(named.sort()).toEqual(
      ['day', 'length', 'patientId', 'providerId', 'start', 'treatmentTypeId'].sort(),
    );
    // No field sets an autocomplete of its own (D-095): the patient search box among them.
    for (const field of [...tags(html, 'input'), ...tags(html, 'select')]) {
      expect(field.has('autocomplete'), field.get('name') ?? field.get('role')).toBe(false);
    }
  });

  it('the day the calendar shows is sent hidden', () => {
    const [day] = tags(render(), 'input').filter((input) => input.get('name') === 'day');
    expect(day?.get('type')).toBe('hidden');
    expect(day?.get('value')).toBe('2026-10-26');
  });
});

describe('start, length and provider come filled in (acceptance 1)', () => {
  it("the start: each quarter hour of the grid in the 24-hour clock, the booking's chosen", () => {
    const starts = optionsOf(render({ start: 10 * H + 30 }), 'start');
    expect(starts).toHaveLength(40);
    expect(starts.slice(0, 2)).toEqual([
      { value: '08:00', text: '08:00', chosen: false },
      { value: '08:15', text: '08:15', chosen: false },
    ]);
    expect(starts.filter((option) => option.chosen)).toEqual([
      { value: '10:30', text: '10:30', chosen: true },
    ]);
  });

  it('the length: 15 to 120 minutes, 30 chosen before a treatment is picked', () => {
    const lengths = optionsOf(render(), 'length');
    expect(lengths.map((option) => option.text)).toEqual([
      '15 min',
      '30 min',
      '45 min',
      '60 min',
      '90 min',
      '120 min',
    ]);
    expect(lengths.filter((option) => option.chosen).map((option) => option.value)).toEqual(['30']);
  });

  it("a treatment picked: its own length offered and chosen, as the treatment's chip sets it", () => {
    const lengths = optionsOf(render({ treatmentId: IMPLANT.id, length: 50 }), 'length');
    expect(lengths.map((option) => option.value)).toEqual([
      '15',
      '30',
      '45',
      '50',
      '60',
      '90',
      '120',
    ]);
    expect(lengths.filter((option) => option.chosen).map((option) => option.value)).toEqual(['50']);
  });

  it('the provider: the active ones by short name, the first one shown chosen', () => {
    expect(optionsOf(render(), 'providerId')).toEqual([
      { value: DENTIST, text: 'Dr. Planinska', chosen: true },
      { value: HYGIENIST, text: 'Lumi', chosen: false },
    ]);
  });

  it('Book names the time and the provider', () => {
    expect(bookText(render())).toBe('Book 09:00 with Dr. Planinska');
    expect(bookText(render({ start: 14 * H + 15, providerId: HYGIENIST }))).toBe(
      'Book 14:15 with Lumi',
    );
  });
});

describe("the treatment's chips", () => {
  it('none pressed until one is picked, and none sent', () => {
    const html = render();
    const chips = tags(html, 'button').filter((button) => button.has('aria-pressed'));
    expect(chips.map((chip) => [chip.get('type'), chip.get('aria-pressed')])).toEqual([
      ['button', 'false'],
      ['button', 'false'],
    ]);
    const [sent] = tags(html, 'input').filter((input) => input.get('name') === 'treatmentTypeId');
    expect(sent?.get('value')).toBe('');
  });

  it('the one picked is pressed, and it is the one sent', () => {
    const html = render({ treatmentId: CHECKUP.id });
    const chips = tags(html, 'button').filter((button) => button.has('aria-pressed'));
    expect(chips.map((chip) => chip.get('aria-pressed'))).toEqual(['true', 'false']);
    const [sent] = tags(html, 'input').filter((input) => input.get('name') === 'treatmentTypeId');
    expect(sent?.get('value')).toBe(CHECKUP.id);
  });

  it('named by the field’s label: a group labelled "Treatment"', () => {
    const html = render();
    const [group] = tags(html, 'div').filter((div) => div.get('role') === 'group');
    const label = group?.get('aria-labelledby') ?? '';
    expect(text(new RegExp(`<span id="${label}"[^>]*>([^<]*)</span>`).exec(html)?.[1] ?? '')).toBe(
      'Treatment',
    );
  });
});

describe('a clinic without treatment types or providers says so (E01-T09 adds them)', () => {
  it('no treatment types: a line in place of the chips', () => {
    const html = render({}, { choices: { treatmentTypes: [] } });
    expect(text(html)).toContain(messages.calendar.booking.noTreatments);
    expect(tags(html, 'button').filter((button) => button.has('aria-pressed'))).toEqual([]);
  });

  it('no provider: a disabled select that says so, and Book without a name', () => {
    const html = render({ providerId: '' }, { choices: { providers: [], firstProviderId: null } });
    const [select] = tags(html, 'select').filter((found) => found.get('name') === 'providerId');
    expect(select?.has('disabled')).toBe(true);
    expect(optionsOf(html, 'providerId').map((option) => option.text)).toEqual([
      messages.calendar.booking.noProviders,
    ]);
    expect(bookText(html)).toBe('Book 09:00');
  });
});

describe("the clinic's refusals, above Book (acceptance 5, D-098)", () => {
  it.each([
    ['overlap', messages.calendar.booking.overlap],
    ['patient_not_bookable', messages.calendar.booking.patientNotBookable],
    ['provider_not_bookable', messages.calendar.booking.providerNotBookable],
    ['treatment_not_bookable', messages.calendar.booking.treatmentNotBookable],
    ['start_skipped', messages.calendar.booking.startSkipped],
  ])('%s: its text, in an alert before the button', (code, message) => {
    const html = render({}, { answer: { kind: 'refused', code } });
    const alert = /<p role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(text(alert?.[1] ?? '')).toBe(message);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
  });

  it('the overlap asks for another time', () => {
    expect(messages.calendar.booking.overlap).toMatch(/Choose another time/);
  });

  it('a patient or a treatment not picked: "Fill this in." at its field', () => {
    const html = render(
      {},
      {
        answer: {
          kind: 'invalid',
          fields: new Map([
            ['patientId', 'missing'],
            ['treatmentTypeId', 'missing'],
          ]),
        },
      },
    );
    const box = tags(html, 'input').find((input) => input.get('role') === 'combobox');
    expect(box?.get('aria-invalid')).toBe('true');
    const errorId = box?.get('aria-describedby') ?? '';
    expect(text(new RegExp(`<p id="${errorId}"[^>]*>([^<]*)</p>`).exec(html)?.[1] ?? '')).toBe(
      messages.form.fieldErrors.missing,
    );
    const [group] = tags(html, 'div').filter((div) => div.get('role') === 'group');
    const groupError = group?.get('aria-describedby') ?? '';
    expect(text(new RegExp(`<p id="${groupError}"[^>]*>([^<]*)</p>`).exec(html)?.[1] ?? '')).toBe(
      messages.form.fieldErrors.missing,
    );
  });
});

describe('New appointment on the calendar', () => {
  it('a button that opens a dialog, closed until pressed; the drawer opens in the browser', () => {
    const view = layoutDay({
      day: '2026-10-26',
      today: '2026-10-26',
      weekday: 1,
      hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
      closedDay: null,
      providers: [],
      breaks: [],
      appointments: [],
    });
    const element = createElement(NewAppointment, {
      view,
      treatmentTypes: [CHECKUP],
      shown: [],
      onBooked: vi.fn(),
    });
    const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
    const provider: ComponentProps<typeof NextIntlClientProvider> = {
      locale: LOCALE,
      messages,
      timeZone: 'Europe/Skopje',
      children: createElement(FrameClinic, frame),
    };
    const html = renderToString(createElement(NextIntlClientProvider, provider));
    const [button] = tags(html, 'button');
    expect([
      button?.get('type'),
      button?.get('aria-haspopup'),
      button?.get('aria-expanded'),
    ]).toEqual(['button', 'dialog', 'false']);
    expect(text(html)).toBe(messages.calendar.booking.open);
  });
});
