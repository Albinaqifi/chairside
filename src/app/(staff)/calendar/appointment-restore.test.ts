import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type {
  AppointmentStatus,
  DayAppointment,
  Provider,
  ProviderBreak,
} from '@/modules/scheduling';
import type { ClosedDay } from '@/modules/tenancy';
import { AppointmentDrawer } from './appointment-drawer';
import { RestoreForm } from './appointment-restore';
import { layoutDay, visitById, type CalendarDayView } from './day';

// E01-T06g: the appointment drawer's Restore as the server renders it, inside the staff frame, with
// next-intl's provider as the root layout gives it: the message file and the clinic's zone.
// useActionState is replaced so a test can choose the form's answer. The press, the request's body,
// the refusals the server gives and the focus afterwards are in tests/e2e/appointment-restore.spec.ts.
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
beforeEach(() => {
  form.state = undefined;
});

// The actions are server code: the forms only hand them to StaffForm and the read.
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

const CLINIC = '01970000-0000-7000-8000-0000000000f8';
const H = 60;
const VISIT = '01970000-0000-7000-8000-0000000005b1';
const OTHER_VISIT = '01970000-0000-7000-8000-0000000005b2';
const PATIENT = '01970000-0000-7000-8000-0000000003b3';
const DENTIST: Provider = {
  id: '01970000-0000-7000-8000-0000000004e1',
  name: 'Elena Planinska',
  shortName: 'Dr. Planinska',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};
const HYGIENIST: Provider = {
  ...DENTIST,
  id: '01970000-0000-7000-8000-0000000004e2',
  name: 'Lumi Dimova',
  shortName: 'Lumi',
  chairLabel: 'Chair 2',
};

type Row = DayAppointment & { patient: { firstName: string; lastName: string } };

/** Local midnight on Monday 26 October 2026 in Skopje (UTC+1) is 23:00 UTC on the Sunday. */
function at(
  providerId: string,
  id: string,
  from: number,
  to: number,
  status: AppointmentStatus = 'booked',
  patient: [string, string] = ['Ana', 'Brezovska'],
): Row {
  return {
    id,
    providerId,
    patientId: PATIENT,
    title: 'Filling 36',
    status,
    note: '',
    startsAt: new Date(Date.UTC(2026, 9, 25, 23, from)),
    endsAt: new Date(Date.UTC(2026, 9, 25, 23, to)),
    startMinute: from,
    endMinute: to,
    actions: status === 'cancelled' || status === 'no_show' ? ['restore'] : ['arrive'],
    movable: false,
    patient: { firstName: patient[0], lastName: patient[1] },
  };
}

function monday(
  rows: {
    appointments?: Row[];
    breaks?: ProviderBreak[];
    closedDay?: ClosedDay | null;
  } = {},
): CalendarDayView {
  return layoutDay({
    day: '2026-10-26',
    today: '2026-10-26',
    weekday: 1,
    hours: [{ weekday: 1, opens: 9 * H, closes: 10 * H }],
    closedDay: rows.closedDay ?? null,
    providers: [DENTIST, HYGIENIST],
    breaks: rows.breaks ?? [],
    appointments: rows.appointments ?? [at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled')],
  });
}

function inFrame(body: ReturnType<typeof createElement>): string {
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: body };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The server's HTML of the Restore form for the visit, on the day the calendar holds. */
function render(view: CalendarDayView, options: { answer?: FormAnswer<unknown> } = {}): string {
  if (options.answer) form.state = { answer: options.answer, attempt: 1 };
  const found = visitById(view, VISIT);
  if (!found) throw new Error('the day has no visit');
  return inFrame(
    createElement(RestoreForm, {
      block: found.block,
      column: found.column,
      held: view,
      onSendingChange: vi.fn(),
    }),
  );
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

/** The submit button's text. */
function submit(html: string): string {
  return /<button[^>]*type="submit"[^>]*>([^<]*)<\/button>/.exec(html)?.[1] ?? '';
}

describe('Restore over a free place', () => {
  it.each<AppointmentStatus>(['cancelled', 'no_show'])(
    'a %s visit: a form of its own with the visit and the action hidden, Restore, no anyway',
    (status) => {
      const html = render(
        monday({ appointments: [at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, status)] }),
      );
      expect(html.match(/<form\b/g)).toHaveLength(1);
      expect(html).toContain(`name="appointmentId" value="${VISIT}"`);
      expect(html).toContain('name="action" value="restore"');
      expect(html).not.toContain('name="anyway"');
      expect(submit(html)).toBe('Restore');
      expect(text(html)).not.toContain('Overlaps');
      expect(html).toMatch(/autoComplete="off"|autocomplete="off"/i);
    },
  );

  it('a cancelled visit’s own place is no overlap with itself, and another provider’s visit is none', () => {
    const html = render(
      monday({
        appointments: [
          at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled'),
          at(HYGIENIST.id, OTHER_VISIT, 9 * H, 9 * H + 30),
        ],
      }),
    );
    expect(submit(html)).toBe('Restore');
    expect(html).not.toContain('name="anyway"');
  });

  it('another cancelled or no-show visit of the provider holds no chair, so it is no overlap', () => {
    const html = render(
      monday({
        appointments: [
          at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled'),
          at(DENTIST.id, OTHER_VISIT, 9 * H + 15, 9 * H + 45, 'no_show', ['Bojan', 'Kamenov']),
        ],
      }),
    );
    expect(submit(html)).toBe('Restore');
    expect(html).not.toContain('name="anyway"');
  });

  it('a break, the hours and a closed day are not warned of: a restore keeps the old place', () => {
    const lunch: ProviderBreak = {
      id: 'lunch',
      providerId: DENTIST.id,
      startMinute: 9 * H,
      endMinute: 10 * H,
      label: 'Lunch',
    };
    // The visit, 09:00 to 09:30, is in a break; the hours (09:00 to 10:00) hold it; make the day closed too.
    const html = render(
      monday({
        breaks: [lunch],
        closedDay: { date: '2026-10-26', label: 'Holiday' },
      }),
    );
    expect(text(html)).not.toContain('Lunch');
    expect(text(html)).not.toContain('closed');
    expect(text(html)).not.toContain('opening hours');
    expect(submit(html)).toBe('Restore');
    expect(html).not.toContain('name="anyway"');
  });
});

describe('Restore over an overlap', () => {
  const view = () =>
    monday({
      appointments: [
        at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled'),
        at(DENTIST.id, OTHER_VISIT, 9 * H + 15, 10 * H, 'booked', ['Bojan', 'Kamenov']),
      ],
    });

  it('names the visit, says Restore anyway, and sends the hidden anyway', () => {
    const html = render(view());
    expect(text(html)).toContain("Overlaps Bojan Kamenov's visit, 09:15–10:00.");
    expect(text(html)).toContain('You can still restore it with Restore anyway.');
    expect(text(html)).not.toContain('Book anyway');
    expect(text(html)).not.toContain('Move anyway');
    expect(submit(html)).toBe('Restore anyway');
    expect(html).toContain('name="anyway" value="true"');
  });

  it('a visit booked anyway over the place holds the chair too', () => {
    const html = render(
      monday({
        appointments: [
          at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled'),
          at(DENTIST.id, OTHER_VISIT, 9 * H, 9 * H + 30, 'confirmed', ['Bojan', 'Kamenov']),
        ],
      }),
    );
    expect(submit(html)).toBe('Restore anyway');
  });

  it('shows only the overlap: a break on the same provider adds no line', () => {
    const lunch: ProviderBreak = {
      id: 'lunch',
      providerId: DENTIST.id,
      startMinute: 9 * H,
      endMinute: 10 * H,
      label: 'Lunch',
    };
    const found = monday({
      breaks: [lunch],
      appointments: [
        at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled'),
        at(DENTIST.id, OTHER_VISIT, 9 * H + 15, 10 * H, 'booked', ['Bojan', 'Kamenov']),
      ],
    });
    const html = render(found);
    expect(text(html)).toContain('Overlaps Bojan Kamenov');
    expect(text(html)).not.toContain('Lunch');
  });
});

describe('the answers, above the button', () => {
  it.each([
    [
      'overlap',
      'This time overlaps another visit of this provider now. Look at the warning before restoring it.',
    ],
    [
      'already_booked',
      'This patient is already booked with this provider at this time, so the visit was not restored.',
    ],
    [
      'provider_not_bookable',
      'This provider takes no new appointments, so the visit was not restored.',
    ],
    [
      'patient_not_bookable',
      'This patient cannot be booked: only an active patient can. The visit stays as it is.',
    ],
    ['not_allowed', 'This visit was changed meanwhile. Look at it again.'],
    ['not_found', 'This visit is no longer there.'],
  ])('%s shows its own text', (code, expected) => {
    const html = render(monday(), { answer: { kind: 'refused', code } });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(expected);
    expect(submit(html)).toBe('Restore');
  });

  it('a refusal without a text of its own shows the general failure', () => {
    const html = render(monday(), { answer: { kind: 'refused', code: 'too_early' } });
    expect(text(html)).toContain('That did not work. Try again.');
  });
});

describe('inside the appointment drawer', () => {
  function drawer(status: AppointmentStatus, view: CalendarDayView): string {
    const found = visitById(view, VISIT);
    if (!found) throw new Error('the day has no visit');
    return inFrame(
      createElement(AppointmentDrawer, {
        block: found.block,
        column: found.column,
        view,
        year: false,
        onClose: vi.fn(),
        onMoved: vi.fn(),
        onBookNext: vi.fn(),
      }),
    );
  }

  it.each<AppointmentStatus>(['cancelled', 'no_show'])(
    'a %s visit has Update status with Restore, no move form and no muted line',
    (status) => {
      const html = drawer(
        status,
        monday({ appointments: [at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, status)] }),
      );
      expect(text(html)).toContain('Update status');
      expect(submit(html)).toBe('Restore');
      expect(text(html)).not.toContain('Nothing to change');
      expect(text(html)).not.toContain('Move this visit');
      // Restore alone spans both columns of the buttons' grid.
      expect(html).toContain('col-span-2');
    },
  );

  it('with an overlap the drawer’s button reads Restore anyway', () => {
    const html = drawer(
      'cancelled',
      monday({
        appointments: [
          at(DENTIST.id, VISIT, 9 * H, 9 * H + 30, 'cancelled'),
          at(DENTIST.id, OTHER_VISIT, 9 * H + 15, 10 * H, 'booked', ['Bojan', 'Kamenov']),
        ],
      }),
    );
    expect(submit(html)).toBe('Restore anyway');
    expect(html).toContain('name="anyway" value="true"');
  });
});
