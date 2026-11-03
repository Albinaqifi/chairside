import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldProblem, FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { DayAppointment, Provider, ProviderBreak } from '@/modules/scheduling';
import type { ClosedDay } from '@/modules/tenancy';
import { AppointmentDrawer } from './appointment-drawer';
import { MoveForm } from './appointment-move';
import { layoutDay, visitById, type CalendarDayView } from './day';

// E01-T06f: the appointment drawer's move form as the server renders it, inside the staff frame, with
// next-intl's provider as the root layout gives it: the message file and the clinic's zone.
// useActionState is replaced so a test can choose the form's answer. The other day's read, the double
// click and the keyboard are in tests/e2e/appointment-move.spec.ts. Names are from the seed's invented
// lists; ids are made up.

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
beforeEach(() => {
  form.state = undefined;
});

// The actions are server code: the form only hands them to StaffForm and the read.
vi.mock('./appointment-actions', () => ({
  changeAppointmentStatus: vi.fn(),
  moveAppointment: vi.fn(),
}));
vi.mock('./actions', () => ({ readCalendarDay: vi.fn() }));

vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const inPlace = ({ children }: { children?: ReactNode }) => children ?? null;
  return { ...actual, Dialog: { ...actual.Dialog, Portal: inPlace } };
});

const CLINIC = '01970000-0000-7000-8000-0000000000f7';
const H = 60;
const VISIT = '01970000-0000-7000-8000-0000000005a1';
const OTHER_VISIT = '01970000-0000-7000-8000-0000000005a2';
const PATIENT = '01970000-0000-7000-8000-0000000003b2';
const DENTIST: Provider = {
  id: '01970000-0000-7000-8000-0000000004c1',
  name: 'Elena Planinska',
  shortName: 'Dr. Planinska',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};
const HYGIENIST: Provider = {
  ...DENTIST,
  id: '01970000-0000-7000-8000-0000000004c2',
  name: 'Lumi Dimova',
  shortName: 'Lumi',
  chairLabel: 'Chair 2',
};
const LEFT: Provider = {
  ...DENTIST,
  id: '01970000-0000-7000-8000-0000000004c3',
  name: 'Kamen Ivanov',
  shortName: 'Kamenov',
  active: false,
};

type Row = DayAppointment & { patient: { firstName: string; lastName: string } };

/** Local midnight on Monday 26 October 2026 in Skopje (UTC+1) is 23:00 UTC on the Sunday. */
function at(providerId: string, id: string, from: number, to: number): Row {
  return {
    id,
    providerId,
    patientId: PATIENT,
    title: 'Filling 36',
    status: 'booked',
    note: '',
    startsAt: new Date(Date.UTC(2026, 9, 25, 23, from)),
    endsAt: new Date(Date.UTC(2026, 9, 25, 23, to)),
    startMinute: from,
    endMinute: to,
    actions: ['arrive'],
    movable: true,
    patient: { firstName: 'Ana', lastName: 'Brezovska' },
  };
}

function monday(
  rows: {
    providers?: Provider[];
    appointments?: Row[];
    breaks?: ProviderBreak[];
    closedDay?: ClosedDay | null;
  } = {},
): CalendarDayView {
  return layoutDay({
    day: '2026-10-26',
    today: '2026-10-26',
    weekday: 1,
    hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
    closedDay: rows.closedDay ?? null,
    providers: rows.providers ?? [DENTIST, HYGIENIST],
    breaks: rows.breaks ?? [],
    appointments: rows.appointments ?? [at(DENTIST.id, VISIT, 9 * H, 9 * H + 30)],
  });
}

/** The server's HTML of the move form for the visit, on the day the calendar holds. */
function render(
  view: CalendarDayView,
  options: { answer?: FormAnswer<unknown>; timeZone?: string; settling?: boolean } = {},
): string {
  if (options.answer) form.state = { answer: options.answer, attempt: 1 };
  const found = visitById(view, VISIT);
  if (!found) throw new Error('the day has no visit');
  const body = createElement(MoveForm, {
    block: found.block,
    column: found.column,
    held: view,
    settling: options.settling ?? false,
    onSendingChange: vi.fn(),
    onMoved: vi.fn(),
  });
  return inFrame(body, options.timeZone ?? 'Europe/Skopje');
}

function inFrame(body: ReturnType<typeof createElement>, timeZone: string): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: body };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone,
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The page's text without its tags. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value of the field called `name`: an input's or the option a select shows. */
function field(html: string, name: string): string | null {
  const input = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`).exec(html);
  if (input) return input[1] ?? null;
  const select = new RegExp(`<select[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return /<option[^>]*value="([^"]*)"[^>]*selected/.exec(select?.[1] ?? '')?.[1] ?? null;
}

/** The submit button's text. */
function submit(html: string): string {
  return /<button[^>]*type="submit"[^>]*>([^<]*)<\/button>/.exec(html)?.[1] ?? '';
}

describe('the form starts on the visit’s own date, time and provider', () => {
  it('shows the heading, the three fields and Move, with the visit hidden', () => {
    const html = render(monday());
    expect(text(html)).toContain('Move this visit');
    expect(field(html, 'day')).toBe('2026-10-26');
    expect(field(html, 'start')).toBe('09:00');
    expect(field(html, 'providerId')).toBe(DENTIST.id);
    expect(submit(html)).toBe('Move');
    expect(html).toContain(`name="appointmentId" value="${VISIT}"`);
    expect(html).toMatch(/<input[^>]*type="date"/);
  });

  it('is a staff form that keeps nothing in the browser and sends no anyway', () => {
    const html = render(monday());
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html).toMatch(/autoComplete="off"|autocomplete="off"/i);
    expect(html).not.toContain('name="anyway"');
  });

  it('offers the grid’s quarter hours and the active providers', () => {
    const html = render(monday({ providers: [DENTIST, HYGIENIST, LEFT] }));
    expect(html).toContain('>08:00<');
    expect(html).toContain('>17:45<');
    expect(html).not.toContain('>18:00<');
    expect(html).toContain('>Dr. Planinska<');
    expect(html).toContain('>Lumi<');
    expect(html).not.toContain('>Kamenov<');
  });

  it('offers a start that is no quarter hour, so the select shows the visit’s 09:10', () => {
    const view = monday({ appointments: [at(DENTIST.id, VISIT, 9 * H + 10, 9 * H + 40)] });
    const html = render(view);
    expect(field(html, 'start')).toBe('09:10');
    expect(html).toContain('>09:10<');
  });

  it('a visit of an inactive provider starts on the first active one', () => {
    const view = monday({
      providers: [LEFT, DENTIST, HYGIENIST],
      appointments: [at(LEFT.id, VISIT, 9 * H, 9 * H + 30)],
    });
    expect(field(render(view), 'providerId')).toBe(DENTIST.id);
  });

  it('with no active provider the select is disabled and sends nothing', () => {
    const view = monday({
      providers: [LEFT],
      appointments: [at(LEFT.id, VISIT, 9 * H, 9 * H + 30)],
    });
    const html = render(view);
    expect(html).toMatch(/<select[^>]*name="providerId"[^>]*disabled/);
    expect(text(html)).toContain('No providers yet');
  });
});

describe('the warnings, on the day the calendar holds', () => {
  it('the visit’s own old place warns of nothing', () => {
    const html = render(monday());
    expect(html).not.toContain('Overlaps');
    expect(submit(html)).toBe('Move');
  });

  it('another visit of the provider is the overlap: Move anyway and the hidden anyway', () => {
    const view = monday({
      appointments: [
        at(DENTIST.id, VISIT, 9 * H, 9 * H + 30),
        at(DENTIST.id, OTHER_VISIT, 9 * H + 15, 10 * H),
      ],
    });
    const html = render(view);
    expect(text(html)).toContain("Overlaps Ana Brezovska's visit, 09:15–10:00.");
    expect(text(html)).toContain('You can still move it with Move anyway.');
    expect(text(html)).not.toContain('Book anyway');
    expect(submit(html)).toBe('Move anyway');
    expect(html).toContain('name="anyway" value="true"');
  });

  it('a break, the hours and a closed day warn and leave the button as it is', () => {
    const lunch: ProviderBreak = {
      id: 'lunch',
      providerId: DENTIST.id,
      startMinute: 9 * H,
      endMinute: 10 * H,
      label: 'Lunch',
    };
    const withBreak = render(monday({ breaks: [lunch] }));
    expect(text(withBreak)).toContain("Overlaps Dr. Planinska's break: Lunch, 09:00–10:00.");
    expect(submit(withBreak)).toBe('Move');
    expect(withBreak).not.toContain('name="anyway"');

    const closed = render(monday({ closedDay: { date: '2026-10-26', label: 'Holiday' } }));
    expect(text(closed)).toContain('The clinic is closed that day: Holiday.');
    expect(submit(closed)).toBe('Move');
  });
});

describe('the answers', () => {
  it.each([
    [
      'overlap',
      'This time overlaps another visit of this provider. Choose another time, or another provider.',
    ],
    [
      'already_booked',
      'This patient is already booked with this provider at this time, so the visit was not moved.',
    ],
    ['provider_not_bookable', 'This provider takes no new appointments. Choose another provider.'],
    ['patient_not_bookable', 'This patient cannot be moved: only an active patient can.'],
    ['start_skipped', 'The clocks skip this start on this day. Choose another time.'],
    ['nothing_changed', 'Nothing changed: choose another day, time or provider.'],
    ['not_movable', 'This visit can no longer be moved. Look at it again.'],
    ['not_found', 'This visit is no longer there.'],
  ])('%s shows its own text above the button', (code, expected) => {
    const html = render(monday(), { answer: { kind: 'refused', code } });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(expected);
  });

  it('a problem of the date shows at its field', () => {
    const fields = new Map<string, FieldProblem>([['day', 'missing']]);
    const html = render(monday(), { answer: { kind: 'invalid', fields } });
    expect(text(html)).toContain('Fill this in.');
  });
});

describe('the settle after the visit’s place changes', () => {
  it('takes no pointer press on the form’s buttons, a key still presses them', () => {
    expect(render(monday(), { settling: true })).toContain('[&amp;_button]:pointer-events-none');
    expect(render(monday(), { settling: false })).not.toContain(
      '[&amp;_button]:pointer-events-none',
    );
  });
});

describe('inside the appointment drawer', () => {
  function drawer(movable: boolean): string {
    const view = monday();
    const found = visitById(view, VISIT);
    if (!found) throw new Error('the day has no visit');
    const body = createElement(AppointmentDrawer, {
      block: { ...found.block, movable },
      column: found.column,
      view,
      year: false,
      onClose: vi.fn(),
      onMoved: vi.fn(),
    });
    return inFrame(body, 'Europe/Skopje');
  }

  it('a movable visit has the form between its details and Update status', () => {
    const html = drawer(true);
    expect(html.indexOf('Move this visit')).toBeGreaterThan(html.indexOf('Chair 1'));
    expect(html.indexOf('Move this visit')).toBeLessThan(html.indexOf('Update status'));
  });

  it('a visit that cannot be moved (arrived, completed, cancelled, no-show) has none', () => {
    const html = drawer(false);
    expect(text(html)).not.toContain('Move this visit');
    expect(html).not.toContain('name="providerId"');
  });
});
