import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import { Sheet } from '@/ui/sheet';
import { startChoices, type BookingChoices } from './booking-choices';
import { layoutDay, type CalendarDayView } from './day';
import type { PointedDay } from './move-choices';
import { BookingDrawer, BookingForm, type Booking } from './new-appointment';

// E01-T06h: the booking form on a day other than the one the drawer opened on, and a drawer opened for
// a patient (Book next visit). The read of another day is ./pointed-day.ts's: it is replaced here by
// the answer a test chooses (`pointed.answer`), as the server runs no effect. Its states and the clicks
// that make them are in tests/e2e/booking-day.spec.ts; what a state offers is in booking-day.test.ts.
// Names are from the seed's invented lists; ids are made up.

const pointed = vi.hoisted(() => ({ answer: undefined as unknown }));
vi.mock('./pointed-day', () => ({
  usePointedDay: (_day: unknown, held: CalendarDayView) => ({
    ...((pointed.answer as PointedDay | undefined) ?? { view: held, state: 'ok' }),
    readAgainAfterSend: () => undefined,
  }),
}));
vi.mock('./actions', () => ({ bookAppointment: vi.fn(), readCalendarDay: vi.fn() }));
vi.mock('../patients/actions', () => ({ searchPatients: vi.fn() }));

// Radix's Portal renders its children in place here, so an open drawer renders on the server.
vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const inPlace = ({ children }: { children?: ReactNode }) => children ?? null;
  return { ...actual, Dialog: { ...actual.Dialog, Portal: inPlace } };
});

beforeEach(() => {
  pointed.answer = undefined;
});

const CLINIC = '01970000-0000-7000-8000-0000000000f7';
const H = 60;
const DENTIST = '01970000-0000-7000-8000-0000000004a1';
const HYGIENIST = '01970000-0000-7000-8000-0000000004b2';
const PROVIDERS = [
  { id: DENTIST, name: 'Elena Planinska', shortName: 'Dr. Planinska', chairLabel: 'Chair 1' },
  { id: HYGIENIST, name: 'Lumi Dimitrova', shortName: 'Lumi', chairLabel: 'Chair 2' },
];

const CHOICES: BookingChoices = {
  day: '2026-10-26',
  today: '2026-10-26',
  starts: startChoices({ from: 8 * H, to: 18 * H }),
  firstStart: 9 * H,
  providers: PROVIDERS.map(({ id, shortName }) => ({ id, shortName })),
  firstProviderId: DENTIST,
  treatmentTypes: [],
};

const FIRST: Booking = {
  patient: null,
  newPatient: null,
  searchText: '',
  treatmentId: null,
  day: '2026-10-26',
  pointed: '2026-10-26',
  start: 9 * H,
  length: 30,
  providerId: DENTIST,
};

/** Monday 23 November 2026 in UTC, open 10:00 to 11:00: the dentist inactive, a visit of the hygienist. */
const OTHER = layoutDay({
  day: '2026-11-23',
  today: '2026-10-26',
  weekday: 1,
  hours: [{ weekday: 1, opens: 10 * H, closes: 11 * H }],
  closedDay: null,
  providers: PROVIDERS.map((found) => ({
    ...found,
    colorHue: 195,
    active: found.id === HYGIENIST,
  })),
  breaks: [],
  appointments: [
    {
      id: '01970000-0000-7000-8000-0000000005a1',
      providerId: HYGIENIST,
      patientId: '01970000-0000-7000-8000-0000000003b2',
      patient: { firstName: 'Ana', lastName: 'Brezovska' },
      title: 'Cleaning',
      status: 'booked',
      note: '',
      // 10:00 to 10:30 in UTC, the zone these tests render in.
      startsAt: new Date('2026-11-23T10:00:00Z'),
      endsAt: new Date('2026-11-23T10:30:00Z'),
      startMinute: 10 * H,
      endMinute: 10 * H + 30,
      actions: [],
      movable: true,
    },
  ],
});

const HELD = layoutDay({
  day: '2026-10-26',
  today: '2026-10-26',
  weekday: 1,
  hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
  closedDay: null,
  providers: PROVIDERS.map((found) => ({ ...found, colorHue: 195, active: true })),
  breaks: [],
  appointments: [],
});

function inFrame(element: ReactElement): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: element };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'UTC',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

function render(booking: Partial<Booking>): string {
  return inFrame(
    createElement(BookingForm, {
      choices: CHOICES,
      view: HELD,
      booking: { ...FIRST, ...booking },
      newPatientId: '01970000-0000-7000-8000-0000000007d1',
      onChange: vi.fn(),
      listOpen: false,
      onListOpen: vi.fn(),
      onDone: vi.fn(),
    }),
  );
}

function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The submit button's text. */
function bookText(html: string): string {
  const button = /<button\b[^>]*type="submit"[^>]*>([\s\S]*?)<\/button>/.exec(html);
  return text(button?.[1] ?? '');
}

/** The opening tag of the input or select named `name`, or '' when the form has none. */
function field(html: string, name: string): string {
  return new RegExp(`<(?:input|select)\\b[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? '';
}

function optionsOf(html: string, name: string): string[] {
  const select = new RegExp(`<select\\b[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return [...(select?.[1] ?? '').matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/g)].map(
    ([, inside]) => text(inside ?? ''),
  );
}

describe('the Day field', () => {
  it('is a date field labelled Day, above the start, length and provider, holding the day typed', () => {
    const html = render({ day: '2026-11-23', pointed: '2026-11-23' });
    expect(field(html, 'day')).toMatch(/type="date"/);
    expect(field(html, 'day')).toMatch(/value="2026-11-23"/);
    const label = /<label\b[^>]*for="([^"]+)"[^>]*>Day<\/label>/.exec(html);
    expect(label?.[1]).toBeDefined();
    expect(field(html, 'day')).toContain(`id="${label?.[1]}"`);
    expect(html.indexOf('name="day"')).toBeLessThan(html.indexOf('name="start"'));
  });

  it('half typed: the field holds nothing', () => {
    const html = render({ day: '', pointed: '2026-11-23' });
    expect(field(html, 'day')).toMatch(/value=""/);
  });
});

describe('another day, known: its grid, its providers, its box (acceptance 2)', () => {
  const known: PointedDay = { view: OTHER, state: 'ok' };

  it('offers that day’s starts with the time held among them, and its active providers', () => {
    pointed.answer = known;
    const html = render({ day: '2026-11-23', pointed: '2026-11-23', start: 9 * H + 5 });
    expect(optionsOf(html, 'start')).toEqual(['09:05', '10:00', '10:15', '10:30', '10:45']);
    expect(optionsOf(html, 'providerId')).toEqual(['Lumi']);
  });

  it('a provider that is not active that day is replaced by the first active one', () => {
    pointed.answer = known;
    const html = render({ day: '2026-11-23', pointed: '2026-11-23', start: 10 * H + 30 });
    expect(bookText(html)).toBe('Book 10:30 with Lumi');
  });

  it('warns of that day’s visit, and Book anyway sends "anyway"', () => {
    pointed.answer = known;
    const html = render({
      day: '2026-11-23',
      pointed: '2026-11-23',
      start: 10 * H + 15,
      providerId: HYGIENIST,
    });
    expect(text(html)).toContain('Overlaps');
    expect(bookText(html)).toBe('Book anyway, 10:15 with Lumi');
    expect(field(html, 'anyway')).toMatch(/value="true"/);
  });

  it('the box still of another day while a changed day’s read is on its way: Book, no "anyway"', () => {
    // The day typed moved to 7 December, whose read has not answered: the view is still 23 November.
    pointed.answer = known;
    const html = render({
      day: '2026-12-07',
      pointed: '2026-12-07',
      start: 10 * H + 15,
      providerId: HYGIENIST,
    });
    expect(text(html)).toContain('Overlaps');
    expect(bookText(html)).toBe('Book 10:15 with Lumi');
    expect(field(html, 'anyway')).toBe('');
  });
});

describe('another day, not read: no box, and a line when the read failed', () => {
  it('failed: the line says the day could not be checked, the box is empty, Book is Book', () => {
    pointed.answer = { view: HELD, state: 'failed' } satisfies PointedDay;
    const html = render({ day: '2026-11-23', pointed: '2026-11-23' });
    expect(text(html)).toContain(messages.calendar.booking.couldNotCheck);
    expect(text(html)).not.toContain('Overlaps');
    expect(field(html, 'anyway')).toBe('');
  });

  it('read fine: no such line', () => {
    expect(text(render({}))).not.toContain(messages.calendar.booking.couldNotCheck);
  });
});

describe('a drawer opened for a patient: Book next visit (E01-T06h)', () => {
  const PATIENT = {
    id: '01970000-0000-7000-8000-0000000003b2',
    firstName: 'Ana',
    lastName: 'Brezovska',
  };

  const drawer = (patient?: typeof PATIENT) => {
    const inside = createElement(BookingDrawer, {
      choices: CHOICES,
      patient,
      view: HELD,
      onBooked: vi.fn(),
    });
    const sheet: ComponentProps<typeof Sheet> = { open: true, children: inside };
    return inFrame(createElement(Sheet, sheet));
  };

  it('has the patient picked, no treatment chosen and the calendar’s day', () => {
    const html = drawer(PATIENT);
    expect(field(html, 'patientId')).toContain(`value="${PATIENT.id}"`);
    expect(html).toContain('value="Ana Brezovska"');
    expect(field(html, 'day')).toMatch(/value="2026-10-26"/);
  });

  it('a drawer opened for nobody has no patient picked', () => {
    expect(field(drawer(), 'patientId')).toContain('value=""');
  });
});
