import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { AppointmentStatus, Provider } from '@/modules/scheduling';
import { layoutDay, type CalendarDayView } from './day';
import { DayCalendar } from './day-calendar';

// E01-T06b, acceptance 3: a visit's block is a button that opens the appointment drawer, a break is
// text, and the empty-slot layer stays behind the blocks. The day as the server sends it, with
// next-intl's provider as the root layout gives it. Clicks and keys are in
// tests/e2e/appointment-drawer.spec.ts. Names are from the seed's invented lists; ids are made up.

const H = 60;
const DENTIST: Provider = {
  id: '01970000-0000-7000-8000-0000000004e1',
  name: 'Elena Planinska',
  shortName: 'Dr. Planinska',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};

function day(status: AppointmentStatus, note = ''): CalendarDayView {
  return layoutDay({
    day: '2026-10-26',
    today: '2026-10-26',
    weekday: 1,
    hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
    closedDay: null,
    providers: [DENTIST],
    breaks: [
      {
        id: 'lunch',
        providerId: DENTIST.id,
        startMinute: 12 * H,
        endMinute: 13 * H,
        label: 'Lunch',
      },
    ],
    appointments: [
      {
        id: '01970000-0000-7000-8000-0000000005f1',
        providerId: DENTIST.id,
        patientId: '01970000-0000-7000-8000-0000000003f1',
        title: 'Filling 36',
        status,
        note,
        startsAt: new Date('2026-10-26T08:00:00Z'),
        endsAt: new Date('2026-10-26T08:30:00Z'),
        startMinute: 9 * H,
        endMinute: 9 * H + 30,
        actions: [],
        movable: true,
        patient: { firstName: 'Ana', lastName: 'Brezovska' },
      },
    ],
  });
}

function render(view: CalendarDayView, props: Partial<ComponentProps<typeof DayCalendar>> = {}) {
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(DayCalendar, { view, ...props }),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The text of an element's markup, without its tags. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('a visit is a button that fills its block (with onOpen)', () => {
  it('a button of type button, with the visit as data-appointment, named by its text', () => {
    const html = render(day('booked'), { onOpen: vi.fn() });
    const button = /<button\b([^>]*)>([\s\S]*?)<\/button>/.exec(
      html.slice(html.indexOf('data-status="booked"')),
    );
    expect(button?.[1]).toContain('type="button"');
    expect(button?.[1]).toContain('data-appointment="01970000-0000-7000-8000-0000000005f1"');
    // The name a screen reader reads: the time, the patient, the title and the status.
    expect(text(button?.[2] ?? '')).toBe('09:00 Ana Brezovska Filling 36 Booked');
  });

  it('the status is read out where no tag line says it, as it was before the drawer', () => {
    const confirmed = render(day('confirmed'), { onOpen: vi.fn() });
    expect(text(confirmed.slice(confirmed.indexOf('data-status="confirmed"')))).toContain(
      '09:00 Ana Brezovska Filling 36 Confirmed',
    );
    const noted = render(day('booked', 'Bring the X-rays'), { onOpen: vi.fn() });
    expect(text(noted.slice(noted.indexOf('data-status="booked"')))).toContain(
      'Bring the X-rays Booked',
    );
  });

  it('a break is no button, and the page has one button per visit besides the chips and the links', () => {
    const html = render(day('booked'), { onOpen: vi.fn() });
    const lunch = /<li\b[^>]*data-break[^>]*>([\s\S]*?)<\/li>/.exec(html);
    expect(lunch?.[1]).not.toContain('<button');
    expect(html.match(/data-appointment=/g)).toHaveLength(1);
  });

  it('the blocks sit in their own list over the slot layer, which is not a button', () => {
    const html = render(day('booked'), { onOpen: vi.fn(), onSlot: vi.fn() });
    expect(html.indexOf('data-slot-layer')).toBeLessThan(html.indexOf('data-appointment='));
    expect(/<[^>]*data-slot-layer[^>]*>/.exec(html)?.[0]).toContain('aria-hidden="true"');
    expect(/<button\b[^>]*data-slot-layer/.test(html)).toBe(false);
  });
});

describe('without onOpen a block is text, as it was drawn before the drawer', () => {
  it('has no button and no data-appointment', () => {
    const html = render(day('booked'));
    expect(html).not.toContain('data-appointment=');
    const block = /<li\b[^>]*data-status="booked"[^>]*>([\s\S]*?)<\/li>/.exec(html);
    expect(block?.[1]).not.toContain('<button');
    expect(text(block?.[1] ?? '')).toContain('Ana Brezovska');
  });
});

describe('the drawer renders where the screen puts it', () => {
  it('appointmentDrawer is drawn once, and nothing when there is none', () => {
    const marker = createElement('i', { 'data-marker': '' });
    expect(render(day('booked'), { appointmentDrawer: marker }).match(/data-marker/g)).toHaveLength(
      1,
    );
    expect(render(day('booked'))).not.toContain('data-marker');
  });
});
