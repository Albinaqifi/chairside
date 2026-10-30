import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { TreatmentType } from '@/modules/scheduling';
import { Sheet } from '@/ui/sheet';
import { startChoices, type BookingChoices } from './booking-choices';
import { BookingDrawer, BookingForm, NewAppointment, type Booking } from './new-appointment';
import { layoutDay, type CalendarDayView, type DayRows } from './day';

// E01-T05a, acceptance 5 (the message), 6 and 8: the booking form of the new-appointment drawer as the
// server renders it, inside the staff frame, with next-intl's provider as the root layout gives it:
// the message file and the clinic's zone. The drawer opens in a portal, which renders nothing on the
// server: its form is rendered here on its own, and the open drawer, for the line under its title,
// with Radix's Portal rendering its children in place (as in src/ui/double-click-guard.test.ts).
// useActionState is replaced so that a test can choose the form's answer, as in
// new-patient-form.test.ts. Clicks and keys are in tests/e2e/booking.spec.ts. Names are from the
// seed's invented lists; ids are made up.

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

// Radix's Portal waits for the browser before it renders anything: here it renders its children in
// place, so an open drawer renders on the server. A closed one still renders nothing.
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const inPlace = ({ children }: { children?: ReactNode }) => children ?? null;
  return { ...actual, Dialog: { ...actual.Dialog, Portal: inPlace } };
});

const CLINIC = '01970000-0000-7000-8000-0000000000f5';
const H = 60;
const DENTIST = '01970000-0000-7000-8000-0000000004a1';
const HYGIENIST = '01970000-0000-7000-8000-0000000004b2';
/** The id the drawer made for a new patient (E01-T05d). */
const NEW_PATIENT_ID = '01970000-0000-7000-8000-0000000007d1';
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
  newPatient: null,
  searchText: '',
  treatmentId: null,
  start: 9 * H,
  length: 30,
  providerId: DENTIST,
};

/**
 * The day the calendar holds, CHOICES's: open 08:00–18:00, a column for each provider, nothing booked
 * and no break, so nothing is warned of (E01-T05b's cases are below).
 */
const VIEW = layoutDay({
  day: CHOICES.day,
  today: CHOICES.today,
  weekday: 1,
  hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
  closedDay: null,
  providers: CHOICES.providers.map((found, index) => ({
    id: found.id,
    name: found.shortName,
    shortName: found.shortName,
    chairLabel: `Chair ${index + 1}`,
    colorHue: 195,
    active: true,
  })),
  breaks: [],
  appointments: [],
});

beforeEach(() => {
  form.state = undefined;
});

/**
 * What the server sends for the form, in a staff frame, in Skopje (or `timeZone`), on the day the
 * calendar holds (VIEW, or `view`).
 */
function render(
  booking: Partial<Booking> = {},
  options: {
    choices?: Partial<BookingChoices>;
    answer?: FormAnswer<unknown>;
    view?: CalendarDayView;
    timeZone?: string;
  } = {},
): string {
  if (options.answer) form.state = { answer: options.answer, attempt: 1 };
  const element = createElement(BookingForm, {
    choices: { ...CHOICES, ...options.choices },
    view: options.view ?? VIEW,
    booking: { ...FIRST, ...booking },
    newPatientId: NEW_PATIENT_ID,
    onChange: vi.fn(),
    listOpen: false,
    onListOpen: vi.fn(),
    onDone: vi.fn(),
  });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: options.timeZone ?? 'Europe/Skopje',
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

/** What the server sends for `element`, in a staff frame, with next-intl's provider in `timeZone`. */
function inFrame(element: ReactElement, timeZone: string): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone,
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/**
 * The drawer opened on `choices`, as the server renders it in a clinic in `timeZone`: the text of the
 * line under its title, in its header (Radix's Description: a screen reader reads it with the title,
 * linked once the drawer is open in the browser).
 */
function drawerLine(choices: BookingChoices, timeZone: string): string {
  const drawer = createElement(BookingDrawer, { choices, view: VIEW, onBooked: vi.fn() });
  const sheet: ComponentProps<typeof Sheet> = { open: true, children: drawer };
  const html = inFrame(createElement(Sheet, sheet), timeZone);
  expect(tags(html, 'div').filter((div) => div.get('role') === 'dialog')).toHaveLength(1);
  const header = /<div\b[^>]*data-slot="sheet-header"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const title = /<h2\b[^>]*data-slot="sheet-title"[^>]*>([\s\S]*?)<\/h2>/.exec(header);
  expect(text(title?.[1] ?? '')).toBe(messages.calendar.booking.title);
  const line = /<p\b[^>]*data-slot="sheet-description"[^>]*>([\s\S]*?)<\/p>/.exec(header);
  if (!title || !line || line.index < title.index) throw new Error('no line under the title');
  return text(line[1] ?? '');
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

describe("the line under the drawer's title: its day and time, the same in every clinic's zone (D-098)", () => {
  // The day is a calendar date and the times are minutes of the day: each is formatted in UTC, never
  // in the clinic's zone, so the line is the same wherever the clinic is. Formatted in the zone, the
  // day would be the day before in New York, behind UTC ("Sunday, October 25"), and 09:00 would move
  // in all three (10:00, 04:00 and 22:00: the times are drawn on 1 January). The zones are named
  // here, never the computer's: CI runs once, in UTC (D-099).
  const ZONES = ['Europe/Skopje', 'America/New_York', 'Pacific/Auckland'];

  it.each(ZONES)('a clinic in %s: on today, 09:00 for 30 minutes', (zone) => {
    expect(drawerLine(CHOICES, zone)).toBe('Monday, October 26 · 09:00–09:30');
  });

  it.each(ZONES)('a clinic in %s: a day of another year than today names its year', (zone) => {
    expect(drawerLine({ ...CHOICES, day: '2031-04-07' }, zone)).toBe(
      'Monday, April 7, 2031 · 09:00–09:30',
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

// E01-T05b: what the drawer warns of above Book, on the day the calendar holds, as the server renders
// it. CHOICES's day, Monday 26 October 2026: in Skopje (UTC+1 that day) local midnight is 23:00 UTC
// the day before; in New York (UTC-4) it is 04:00 UTC. The rules alone are in booking-warnings.test.ts.

type DayVisit = DayRows['appointments'][number];

/** A visit of the provider, `from` to `to` in minutes of the day, in a clinic whose midnight is `midnightUtc`. */
function visitOf(
  providerId: string,
  from: number,
  to: number,
  fields: { status?: DayVisit['status']; name?: [string, string]; midnightUtc?: Date } = {},
): DayVisit {
  const midnight = (fields.midnightUtc ?? new Date('2026-10-25T23:00:00Z')).getTime();
  const [firstName, lastName] = fields.name ?? ['Ana', 'Brezovska'];
  return {
    id: `01970000-0000-7000-8000-00000000${String(from).padStart(4, '0')}`,
    providerId,
    patientId: '01970000-0000-7000-8000-000000000301',
    title: 'Checkup',
    status: fields.status ?? 'booked',
    note: '',
    startsAt: new Date(midnight + from * 60_000),
    endsAt: new Date(midnight + to * 60_000),
    startMinute: from,
    endMinute: to,
    actions: [],
    patient: { firstName, lastName },
  };
}

/** The dentist's lunch, 12:00 to 13:00. */
const LUNCH = {
  id: 'lunch-dentist',
  providerId: DENTIST,
  startMinute: 12 * H,
  endMinute: 13 * H,
  label: 'Lunch',
};

/** CHOICES's day with these rows: VIEW's hours and providers unless given. */
function dayWith(rows: Partial<DayRows>): CalendarDayView {
  return layoutDay({
    day: CHOICES.day,
    today: CHOICES.today,
    weekday: 1,
    hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
    closedDay: null,
    providers: CHOICES.providers.map((found, index) => ({
      id: found.id,
      name: found.shortName,
      shortName: found.shortName,
      chairLabel: `Chair ${index + 1}`,
      colorHue: 195,
      active: true,
    })),
    breaks: [],
    appointments: [],
    ...rows,
  });
}

/**
 * Where the warning's live region starts: the last one before Book (the patient field has one of its
 * own, further up), and after the provider's select, the last field.
 */
function warningAt(html: string): number {
  const at = html.lastIndexOf('<div role="status">', html.indexOf('type="submit"'));
  if (at === -1 || at < html.indexOf('name="providerId"')) throw new Error('no warning region');
  return at;
}

/** The warning's live region, as written: from its start up to the form's own message or Book. */
function warningRegion(html: string): string {
  const rest = html.slice(warningAt(html));
  const ends = ['role="alert"', 'type="submit"']
    .map((mark) => rest.indexOf(mark))
    .filter((at) => at !== -1);
  return rest.slice(0, Math.min(...ends)).replace(/<[^>]*$/, '');
}

/** Each line of the warning. */
function warningLines(html: string): string[] {
  return [...warningRegion(html).matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inside = '']) =>
    text(inside),
  );
}

/** The hidden "anyway", when the form sends it. */
function anywayField(html: string): string | undefined {
  return tags(html, 'input')
    .find((input) => input.get('name') === 'anyway')
    ?.get('value');
}

/** The form's own message: its alert's text. */
function alertText(html: string): string {
  return text(/<p role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '');
}

describe('an overlap: the other visit named above Book, and Book anyway (E01-T05b, acceptance 1)', () => {
  const WITH_OTHER = dayWith({ appointments: [visitOf(DENTIST, 9 * H, 9 * H + 30)] });

  it("names the other visit's patient and its time, says it can still be booked, and Book is Book anyway", () => {
    const html = render({ start: 9 * H + 15 }, { view: WITH_OTHER });
    expect(warningLines(html)).toEqual(["Overlaps Ana Brezovska's visit, 09:00–09:30."]);
    expect(text(warningRegion(html))).toContain(messages.calendar.booking.warning.anyway);
    expect(bookText(html)).toBe('Book anyway, 09:15 with Dr. Planinska');
    // The person's "anyway" is sent with it.
    expect(anywayField(html)).toBe('true');
  });

  it('sits above Book, under the fields, in a live region', () => {
    const html = render({ start: 9 * H + 15 }, { view: WITH_OTHER });
    const at = warningAt(html);
    expect(at).toBeGreaterThan(html.indexOf('name="providerId"'));
    expect(at).toBeLessThan(html.indexOf('type="submit"'));
    expect(html.slice(at)).toMatch(/^<div role="status"><div [^>]*><ul/);
  });

  it('nothing overlapped: no warning, Book, and no "anyway" sent; the live region is there, empty', () => {
    // Back to back with the other visit.
    const html = render({ start: 9 * H + 30 }, { view: WITH_OTHER });
    expect(text(warningRegion(html))).toBe('');
    expect(bookText(html)).toBe('Book 09:30 with Dr. Planinska');
    expect(anywayField(html)).toBeUndefined();
  });

  it.each([
    { what: 'a start after it', booking: { start: 9 * H + 30 }, anyway: false },
    { what: 'a start on it', booking: { start: 9 * H }, anyway: true },
    {
      what: 'a length that ends before it',
      booking: { start: 8 * H + 45, length: 15 },
      anyway: false,
    },
    {
      what: 'a length that runs into it',
      booking: { start: 8 * H + 45, length: 30 },
      anyway: true,
    },
    { what: 'another provider', booking: { start: 9 * H, providerId: HYGIENIST }, anyway: false },
  ])('follows start, length and provider: $what', ({ booking, anyway }) => {
    const html = render(booking, { view: WITH_OTHER });
    expect(warningLines(html)).toHaveLength(anyway ? 1 : 0);
    expect(bookText(html).startsWith('Book anyway')).toBe(anyway);
    expect(anywayField(html)).toBe(anyway ? 'true' : undefined);
  });

  it('every visit it overlaps, each with its patient, by start; a cancelled one or a no-show is none', () => {
    const view = dayWith({
      appointments: [
        visitOf(DENTIST, 9 * H + 30, 10 * H + 30, { name: ['Marko', 'Dardha'] }),
        visitOf(DENTIST, 9 * H, 10 * H),
        visitOf(DENTIST, 9 * H + 45, 10 * H + 15, {
          status: 'cancelled',
          name: ['Bojan', 'Kamenov'],
        }),
        visitOf(DENTIST, 9 * H + 50, 10 * H + 10, { status: 'no_show', name: ['Elena', 'Lumi'] }),
      ],
    });
    expect(warningLines(render({ start: 9 * H + 45 }, { view }))).toEqual([
      "Overlaps Ana Brezovska's visit, 09:00–10:00.",
      "Overlaps Marko Dardha's visit, 09:30–10:30.",
    ]);
  });

  // The zones are named here, never the computer's: CI runs once, in UTC (D-099). Local midnight of
  // 26 October 2026 is 23:00 UTC the day before in Skopje (UTC+1), 04:00 UTC in New York (UTC-4,
  // behind UTC) and 11:00 UTC the day before in Auckland (UTC+13, far ahead): a visit at 09:00 there,
  // shown in UTC, would read 08:00, 13:00 and 20:00.
  it.each([
    { zone: 'Europe/Skopje', midnightUtc: '2026-10-25T23:00:00Z' },
    { zone: 'America/New_York', midnightUtc: '2026-10-26T04:00:00Z' },
    { zone: 'Pacific/Auckland', midnightUtc: '2026-10-25T11:00:00Z' },
  ])(
    "the other visit's time is a moment, shown in the clinic's zone as the grid shows it: a clinic in $zone",
    ({ zone, midnightUtc }) => {
      const visit = visitOf(DENTIST, 9 * H, 9 * H + 30, { midnightUtc: new Date(midnightUtc) });
      const view = dayWith({ appointments: [visit] });
      expect(warningLines(render({ start: 9 * H }, { view, timeZone: zone }))).toEqual([
        "Overlaps Ana Brezovska's visit, 09:00–09:30.",
      ]);
    },
  );

  it('the calendar holds another day (past midnight, a page on today): nothing is warned of', () => {
    const nextDay = layoutDay({
      day: '2026-10-27',
      today: '2026-10-27',
      weekday: 2,
      hours: [],
      closedDay: null,
      providers: [],
      breaks: [],
      appointments: [],
    });
    const html = render({ start: 9 * H }, { view: nextDay });
    expect(text(warningRegion(html))).toBe('');
    expect(bookText(html)).toBe('Book 09:00 with Dr. Planinska');
  });

  it('refused as an overlap, with the day brought again: the refusal, the warning naming that visit, and Book anyway (acceptance 2)', () => {
    const html = render(
      { start: 9 * H },
      { view: WITH_OTHER, answer: { kind: 'refused', code: 'overlap' } },
    );
    expect(alertText(html)).toBe(messages.calendar.booking.overlap);
    expect(warningLines(html)).toEqual(["Overlaps Ana Brezovska's visit, 09:00–09:30."]);
    expect(bookText(html)).toBe('Book anyway, 09:00 with Dr. Planinska');
  });
});

describe('one booking per click: the same booking again (E01-T05b, acceptance 3)', () => {
  it('already_booked: its text, in an alert above Book', () => {
    const html = render({}, { answer: { kind: 'refused', code: 'already_booked' } });
    expect(alertText(html)).toBe(messages.calendar.booking.alreadyBooked);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
  });
});

describe('a warning line for a break, the hours or a closed day; Book still books (E01-T05b, acceptance 4)', () => {
  /** The lines, Book's text and the "anyway" sent, for a booking on `view`, in Skopje or `timeZone`. */
  function warned(booking: Partial<Booking>, view: CalendarDayView, timeZone?: string) {
    const html = render(booking, { view, timeZone });
    return { lines: warningLines(html), book: bookText(html), anyway: anywayField(html) };
  }

  it("the provider's break, by its label and time; not another provider's, nor one it only touches", () => {
    const view = dayWith({ breaks: [LUNCH] });
    expect(warned({ start: 12 * H + 15 }, view)).toEqual({
      lines: ["Overlaps Dr. Planinska's break: Lunch, 12:00–13:00."],
      book: 'Book 12:15 with Dr. Planinska',
      anyway: undefined,
    });
    expect(warned({ start: 12 * H, providerId: HYGIENIST }, view).lines).toEqual([]);
    expect(warned({ start: 11 * H + 30 }, view).lines).toEqual([]);
  });

  it('a time partly outside the hours, at either end: the day’s hours named', () => {
    expect(warned({ start: 17 * H + 45 }, dayWith({}))).toEqual({
      lines: ['Runs outside the opening hours, 08:00–18:00.'],
      book: 'Book 17:45 with Dr. Planinska',
      anyway: undefined,
    });
    expect(warned({ start: 7 * H + 45 }, dayWith({})).lines).toEqual([
      'Runs outside the opening hours, 08:00–18:00.',
    ]);
  });

  it('a closed day, by its label', () => {
    const view = dayWith({ closedDay: { date: CHOICES.day, label: 'Staff training day' } });
    expect(warned({ start: 9 * H }, view)).toEqual({
      lines: ['The clinic is closed that day: Staff training day.'],
      book: 'Book 09:00 with Dr. Planinska',
      anyway: undefined,
    });
  });

  // The day is a calendar date: its weekday is formatted in UTC, never in the clinic's zone (D-098).
  // In New York, behind UTC, 26 October would be the Sunday before; the zones are named, never the
  // computer's (D-099).
  it.each(['Europe/Skopje', 'America/New_York', 'Pacific/Auckland'])(
    'a weekday without hours, by its name: a clinic in %s',
    (zone) => {
      const view = dayWith({ hours: [{ weekday: 2, opens: 8 * H, closes: 18 * H }] });
      expect(warned({ start: 9 * H }, view, zone)).toEqual({
        lines: ['The clinic is closed that day: no opening hours on Monday.'],
        book: 'Book 09:00 with Dr. Planinska',
        anyway: undefined,
      });
    },
  );

  it('none inside the hours, on an open day, outside every break', () => {
    const view = dayWith({ breaks: [LUNCH] });
    for (const start of [8 * H, 11 * H + 30, 13 * H, 17 * H + 30]) {
      expect(warned({ start }, view).lines, `${start}`).toEqual([]);
    }
  });

  it('an overlap and a break at once: a line each, the visit first, and Book anyway', () => {
    const view = dayWith({
      appointments: [visitOf(DENTIST, 11 * H + 30, 12 * H + 30)],
      breaks: [LUNCH],
    });
    expect(warned({ start: 12 * H }, view)).toEqual({
      lines: [
        "Overlaps Ana Brezovska's visit, 11:30–12:30.",
        "Overlaps Dr. Planinska's break: Lunch, 12:00–13:00.",
      ],
      book: 'Book anyway, 12:00 with Dr. Planinska',
      anyway: 'true',
    });
  });
});

// E01-T05d: a new patient in one go. The drawer shows the new patient's fields in place of the search
// once "Add … as new patient" is taken (./patient-field.test.ts, ./new-patient.test.ts).

/** A new patient as the drawer holds them, from the words "Vesna Trajkovska". */
const VESNA = {
  typed: 'Vesna Trajkovska',
  firstName: 'Vesna',
  lastName: 'Trajkovska',
  phone: '',
  email: '',
};

describe('the new patient: fields of the booking, filled from the words typed (E01-T05d)', () => {
  it('first name, last name, phone and email in place of the search, the names as typed, the drawer’s id hidden', () => {
    const html = render({ newPatient: VESNA });
    expect(tags(html, 'input').find((input) => input.get('role') === 'combobox')).toBeUndefined();
    const named = [...tags(html, 'input'), ...tags(html, 'select')]
      .map((field) => field.get('name'))
      .filter((name) => name !== undefined);
    expect(named.sort()).toEqual(
      [
        'day',
        'email',
        'firstName',
        'lastName',
        'length',
        'newPatientId',
        'phone',
        'providerId',
        'start',
        'treatmentTypeId',
      ].sort(),
    );
    const byName = (name: string) =>
      tags(html, 'input').find((input) => input.get('name') === name);
    expect(byName('firstName')?.get('value')).toBe('Vesna');
    expect(byName('lastName')?.get('value')).toBe('Trajkovska');
    expect(byName('phone')?.get('type')).toBe('tel');
    expect(byName('email')?.get('type')).toBe('email');
    expect(byName('newPatientId')?.get('type')).toBe('hidden');
    expect(byName('newPatientId')?.get('value')).toBe(NEW_PATIENT_ID);
    // Each named by its label.
    for (const name of ['firstName', 'lastName', 'phone', 'email']) {
      const id = byName(name)?.get('id') ?? '';
      expect(html).toContain(`for="${id}"`);
    }
  });

  it('no field of the new patient sets an autocomplete of its own (D-095, acceptance 6)', () => {
    const html = render({ newPatient: { ...VESNA, phone: '070 001 234' } });
    expect(tags(html, 'form')[0]?.get('autocomplete')).toBe('off');
    for (const field of [...tags(html, 'input'), ...tags(html, 'select')]) {
      expect(field.has('autocomplete'), field.get('name')).toBe(false);
    }
  });

  it('"Back to the search" is a button that sends nothing', () => {
    const html = render({ newPatient: VESNA });
    const back = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(
      ([, , inside = '']) => text(inside) === messages.calendar.booking.backToSearch,
    );
    expect(back?.[1]).toContain('type="button"');
  });

  it('back to the search: the box holds the text typed again (acceptance 2)', () => {
    const html = render({ newPatient: null, searchText: 'Vesna Trajkovska' });
    const box = tags(html, 'input').find((input) => input.get('role') === 'combobox');
    expect(box?.get('value')).toBe('Vesna Trajkovska');
  });

  it('a problem of a name or the email shows at its field (acceptance 4)', () => {
    const html = render(
      { newPatient: { ...VESNA, firstName: '', email: 'vesna' } },
      {
        answer: {
          kind: 'invalid',
          fields: new Map([
            ['firstName', 'missing'],
            ['email', 'invalidFormat'],
          ]),
        },
      },
    );
    for (const [name, problem] of [
      ['firstName', messages.form.fieldErrors.missing],
      ['email', messages.form.fieldErrors.invalidFormat],
    ] as const) {
      const input = tags(html, 'input').find((found) => found.get('name') === name);
      expect(input?.get('aria-invalid'), name).toBe('true');
      const errorId = input?.get('aria-describedby') ?? '';
      expect(text(new RegExp(`<p id="${errorId}"[^>]*>([^<]*)</p>`).exec(html)?.[1] ?? '')).toBe(
        problem,
      );
    }
  });

  it.each([
    ['phone_impossible', messages.calendar.booking.phoneImpossible],
    ['new_patient_forbidden', messages.calendar.booking.newPatientForbidden],
  ])('%s: its text, in an alert above Book (acceptance 4, D-098)', (code, message) => {
    const html = render({ newPatient: VESNA }, { answer: { kind: 'refused', code } });
    const alert = /<p role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(text(alert?.[1] ?? '')).toBe(message);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
  });

  it("the impossible phone's text is the new-patient page's", () => {
    expect(messages.calendar.booking.phoneImpossible).toBe(messages.newPatient.phoneImpossible);
  });
});

describe('without a phone and an email: a line says no reminder can reach them, and Book still books (E01-T05d, acceptance 3)', () => {
  const line = messages.calendar.booking.unreachable;

  it('neither: the line, under the fields, in a live region; Book as ever', () => {
    const html = render({ newPatient: VESNA });
    expect(text(html)).toContain(line);
    const status = html.indexOf(line);
    expect(html.lastIndexOf('role="status"', status)).toBeGreaterThan(html.indexOf('name="email"'));
    expect(text(html)).toContain('Book 09:00 with Dr. Planinska');
  });

  it('a phone or an email: no line', () => {
    expect(text(render({ newPatient: { ...VESNA, phone: '070 001 234' } }))).not.toContain(line);
    expect(
      text(render({ newPatient: { ...VESNA, email: 'vesna.trajkovska@example.test' } })),
    ).not.toContain(line);
  });

  it('a picked patient: no line', () => {
    const picked = {
      id: '01970000-0000-7000-8000-0000000011aa',
      firstName: 'Ana',
      lastName: 'Brezovska',
    };
    expect(text(render({ patient: picked }))).not.toContain(line);
  });
});
