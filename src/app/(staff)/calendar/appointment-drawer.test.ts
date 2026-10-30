import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormAnswer } from '@/app/_lib/form-answer';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { AppointmentStatus, Provider, StatusAction } from '@/modules/scheduling';
import { AppointmentDrawer } from './appointment-drawer';
import { layoutDay, visitById, type AppointmentBlock, type Column } from './day';

// E01-T06b, E01-T06e: the appointment drawer as the server renders it, inside the staff frame, with next-intl's
// provider as the root layout gives it: the message file and the clinic's zone. The drawer opens in a
// portal, which renders nothing on the server: here Radix's Portal renders in place, as in
// new-appointment.test.ts. useActionState is replaced so a test can choose the forms' answer (every
// status form of one drawer shows the one answer). Clicks, keys, focus and the real change are in
// tests/e2e/appointment-drawer.spec.ts. Names are from the seed's invented lists; ids are made up.

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

// The action is server code: the forms only hand it to StaffForm.
vi.mock('./appointment-actions', () => ({ changeAppointmentStatus: vi.fn() }));

vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const inPlace = ({ children }: { children?: ReactNode }) => children ?? null;
  return { ...actual, Dialog: { ...actual.Dialog, Portal: inPlace } };
});

const CLINIC = '01970000-0000-7000-8000-0000000000f6';
const H = 60;
const VISIT = '01970000-0000-7000-8000-0000000005a1';
const PATIENT = '01970000-0000-7000-8000-0000000003b2';
const DENTIST: Provider = {
  id: '01970000-0000-7000-8000-0000000004c1',
  name: 'Elena Planinska',
  shortName: 'Dr. Planinska',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};

function block(
  status: AppointmentStatus,
  actions: StatusAction[],
  fields: Partial<AppointmentBlock> = {},
): AppointmentBlock {
  return {
    kind: 'appointment',
    id: VISIT,
    // 09:00 to 09:30 on Monday 26 October 2026 in Skopje (UTC+1): 08:00 UTC.
    startsAt: '2026-10-26T08:00:00.000Z',
    endsAt: '2026-10-26T08:30:00.000Z',
    patientId: PATIENT,
    patient: { firstName: 'Ana', lastName: 'Brezovska' },
    title: 'Filling 36',
    status,
    note: '',
    actions,
    movable: true,
    from: 9 * H,
    to: 9 * H + 30,
    lane: 0,
    lanes: 1,
    ...fields,
  };
}

const COLUMN: Column = {
  providerId: DENTIST.id,
  name: DENTIST.name,
  shortName: DENTIST.shortName,
  initials: 'EP',
  chairLabel: DENTIST.chairLabel,
  hue: DENTIST.colorHue,
  active: true,
  percentBooked: null,
  blocks: [],
};

function render(
  shown: AppointmentBlock,
  options: { answer?: FormAnswer<unknown>; timeZone?: string; year?: boolean } = {},
): string {
  if (options.answer) form.state = { answer: options.answer, attempt: 1 };
  const drawer = createElement(AppointmentDrawer, {
    block: shown,
    column: COLUMN,
    year: options.year ?? false,
    onClose: vi.fn(),
  });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: drawer };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: options.timeZone ?? 'Europe/Skopje',
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

/** The status forms' buttons, in the order they are drawn. */
function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*type="submit"[^>]*>([^<]*)<\/button>/g)].map(
    ([, label = '']) => label,
  );
}

/** The buttons that open the cancel dialog (a dialog trigger, no submit), by their text. */
function dialogTriggers(html: string): string[] {
  return [...html.matchAll(/<button[^>]*aria-haspopup="dialog"[^>]*>([^<]*)<\/button>/g)].map(
    ([, label = '']) => label,
  );
}

/** The hidden `action` values, in the order they are drawn. */
function hiddenActions(html: string): string[] {
  return [...html.matchAll(/<input[^>]*type="hidden"[^>]*name="action"[^>]*value="([^"]*)"/g)].map(
    ([, value = '']) => value,
  );
}

describe('the header: the patient, the treatment, the pill, the day and time, the provider', () => {
  it('names the patient and the treatment, with the status pill', () => {
    const html = render(block('confirmed', ['arrive']));
    expect(html).toContain('Ana Brezovska');
    expect(html).toContain('Filling 36');
    expect(html).toMatch(/data-slot="badge"[^>]*data-variant="confirmed"[^>]*>Confirmed</);
  });

  it('the pill has the status colours: no-show uses the hyphened variant', () => {
    expect(render(block('no_show', []))).toMatch(/data-variant="no-show"[^>]*>No-show</);
  });

  it.each([
    ['Europe/Skopje', 'Monday, October 26 · 09:00–09:30'],
    ['America/New_York', 'Monday, October 26 · 04:00–04:30'],
    ['Pacific/Auckland', 'Monday, October 26 · 21:00–21:30'],
  ])("in %s the day and the time are the clinic's, 24-hour: %s", (timeZone, expected) => {
    expect(text(render(block('booked', []), { timeZone }))).toContain(expected);
  });

  it('a visit that starts late in the evening shows its clinic day, not the UTC day', () => {
    // 23:30 to 00:00 on Monday in New York (UTC-4 on 26 October 2026) is 03:30 UTC on Tuesday.
    const late = block('booked', [], {
      startsAt: '2026-10-27T03:30:00.000Z',
      endsAt: '2026-10-27T04:00:00.000Z',
    });
    expect(text(render(late, { timeZone: 'America/New_York' }))).toContain(
      'Monday, October 26 · 23:30–00:00',
    );
  });

  it('shows the year only when the day is not in the current year', () => {
    expect(text(render(block('booked', []), { year: true }))).toContain(
      'Monday, October 26, 2026 · 09:00',
    );
  });

  it('shows the provider and the chair', () => {
    expect(text(render(block('booked', [])))).toContain('Elena Planinska · Chair 1');
  });
});

describe('Update status: a button for each action the visit has, in this order, no more', () => {
  it.each<[AppointmentStatus, StatusAction[], string[]]>([
    [
      'booked',
      ['confirm', 'arrive', 'complete', 'no_show', 'cancel'],
      ['In the chair', 'Done', 'No-show', 'Confirm'],
    ],
    ['booked', ['confirm', 'arrive', 'complete', 'cancel'], ['In the chair', 'Done', 'Confirm']],
    ['confirmed', ['arrive', 'complete', 'no_show', 'cancel'], ['In the chair', 'Done', 'No-show']],
    ['arrived', ['complete', 'undo_arrival'], ['Done', 'Undo in the chair']],
    ['completed', ['undo_completion'], ['Undo done']],
  ])('%s with %j: %j', (status, actions, labels) => {
    const html = render(block(status, actions));
    expect(buttons(html)).toEqual(labels);
    expect(text(html)).toContain('Update status');
    expect(text(html)).not.toContain('Nothing to change');
  });

  it('shows Cancel last, as the one button that opens the cancel dialog, and no Restore, whatever the module allows (E01-T06e, E01-T06c)', () => {
    const all: StatusAction[] = [
      'confirm',
      'arrive',
      'complete',
      'no_show',
      'cancel',
      'undo_arrival',
      'undo_completion',
      'restore',
    ];
    const html = render(block('booked', all));
    // The status forms, then the one button that is no form: it sends nothing, it opens the dialog.
    expect(buttons(html)).toEqual([
      'In the chair',
      'Done',
      'No-show',
      'Confirm',
      'Undo in the chair',
      'Undo done',
    ]);
    expect(dialogTriggers(html)).toEqual(['Cancel']);
    expect(buttons(html)).not.toContain('Restore');
    expect(hiddenActions(html)).not.toContain('cancel');
    expect(hiddenActions(html)).not.toContain('restore');
    expect(html.indexOf('>Confirm<')).toBeLessThan(html.indexOf('>Cancel<'));
  });

  it('the cancel dialog is closed until Cancel is pressed: no form of it is on the page, and Cancel is no submit button', () => {
    const html = render(block('booked', ['arrive', 'cancel']));
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(text(html)).not.toContain('Who cancelled');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-expanded="false"[^>]*>Cancel</);
  });

  it('each button is a form of its own with the visit and the action hidden', () => {
    const html = render(block('arrived', ['complete', 'undo_arrival']));
    expect(html.match(/<form\b/g)).toHaveLength(2);
    expect(hiddenActions(html)).toEqual(['complete', 'undo_arrival']);
    expect(html.match(new RegExp(`name="appointmentId" value="${VISIT}"`, 'g'))).toHaveLength(2);
    // A form posts to a URL or takes a function, and keeps nothing in the browser (D-076, D-093).
    expect(html.match(/autoComplete="off"|autocomplete="off"/gi)?.length).toBeGreaterThanOrEqual(2);
  });

  it.each<[AppointmentStatus, StatusAction[]]>([
    ['completed', []],
    ['cancelled', ['restore']],
    ['no_show', ['restore']],
  ])(
    'a %s visit that has no button for %j shows a muted line, no empty heading',
    (status, actions) => {
      const html = render(block(status, actions));
      expect(buttons(html)).toEqual([]);
      expect(text(html)).toContain('Nothing to change on this visit.');
      expect(text(html)).not.toContain('Update status');
    },
  );
});

describe('a visit with Cancel as its only button', () => {
  it('still has the Update status heading and the one button', () => {
    const html = render(block('booked', ['cancel']));
    expect(text(html)).toContain('Update status');
    expect(text(html)).not.toContain('Nothing to change');
    expect(dialogTriggers(html)).toEqual(['Cancel']);
    expect(buttons(html)).toEqual([]);
  });
});

describe("the forms' answers (acceptance 5)", () => {
  it.each([
    ['not_allowed', 'This visit was changed meanwhile. Look at it again.'],
    ['too_early', 'A no-show can be marked once the visit has started.'],
    ['not_found', 'This visit is no longer there.'],
  ])('%s shows its text above the button', (code, expected) => {
    const html = render(block('booked', ['arrive']), { answer: { kind: 'refused', code } });
    expect(html).toContain(`role="alert"`);
    expect(text(html)).toContain(expected);
    expect(buttons(html)).toEqual(['In the chair']);
  });

  it('a refusal without a text of its own shows the general failure', () => {
    const html = render(block('booked', ['arrive']), {
      answer: { kind: 'refused', code: 'overlap' },
    });
    expect(text(html)).toContain('That did not work. Try again.');
  });
});

describe('the profile link (acceptance 7)', () => {
  it('is a link to the patient, at the foot, that does not prefetch', () => {
    const html = render(block('booked', []));
    const link = new RegExp(`<a\\b[^>]*href="/patients/${PATIENT}"[^>]*>Patient profile</a>`).exec(
      html,
    );
    expect(link).not.toBeNull();
    // next/link writes no prefetch hint into the HTML of a link whose prefetch is false.
    expect(link?.[0]).not.toMatch(/prefetch/i);
  });
});

describe('visitById: the visit the drawer shows is the one the day holds now (acceptance 3, 5)', () => {
  const providers = [
    DENTIST,
    { ...DENTIST, id: '01970000-0000-7000-8000-0000000004c2', name: 'Arben Kodra' },
  ];
  const day = (visitIds: string[]) =>
    layoutDay({
      day: '2026-10-26',
      today: '2026-10-26',
      weekday: 1,
      hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
      closedDay: null,
      providers,
      breaks: [
        {
          id: 'lunch',
          providerId: DENTIST.id,
          startMinute: 12 * H,
          endMinute: 13 * H,
          label: 'Lunch',
        },
      ],
      appointments: visitIds.map((id, index) => ({
        id,
        providerId: providers[index % 2]?.id ?? DENTIST.id,
        patientId: PATIENT,
        title: 'Checkup',
        status: 'booked',
        note: '',
        startsAt: new Date('2026-10-26T08:00:00Z'),
        endsAt: new Date('2026-10-26T08:30:00Z'),
        startMinute: 9 * H,
        endMinute: 9 * H + 30,
        actions: ['arrive'],
        movable: true,
        patient: { firstName: 'Ana', lastName: 'Brezovska' },
      })),
    });

  it('finds a visit in any column, with its column', () => {
    const view = day(['a', 'b']);
    expect(visitById(view, 'b')?.column.name).toBe('Arben Kodra');
    expect(visitById(view, 'a')?.column.name).toBe('Elena Planinska');
    expect(visitById(view, 'b')?.block.id).toBe('b');
  });

  it('finds nothing for a visit the day no longer holds, and nothing for a break', () => {
    expect(visitById(day(['a']), 'b')).toBeNull();
    expect(visitById(day([]), 'a')).toBeNull();
    expect(visitById(day(['a']), 'lunch')).toBeNull();
  });
});
