import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FrameClinic } from '@/app/_lib/frame-clinic';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { Provider } from '@/modules/scheduling';
import { CalendarScreen } from './calendar-screen';
import { layoutDay, type CalendarDayView } from './day';

// E01-T04b: the calendar as the server first sends it, inside the staff frame, with next-intl's
// provider as the root layout gives it: the columns a member opens on, from the provider their
// membership is linked to (the read: tests/integration/calendar-own-column.test.ts), and no "now"
// line before the page runs in the browser. Clicks, the clock and the reading on use are in
// tests/e2e/calendar.spec.ts. Names are from the seed's invented lists; ids are made up.

// The read is server code: the calendar only hands it to readAgain.
vi.mock('./actions', () => ({ readCalendarDay: vi.fn() }));

const CLINIC = '01970000-0000-7000-8000-0000000000d1';
const H = 60;

const DENTIST: Provider = {
  id: '01970000-0000-7000-8000-0000000004d1',
  name: 'Elena Planinska',
  shortName: 'Dr. Planinska',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};
const SECOND: Provider = {
  ...DENTIST,
  id: '01970000-0000-7000-8000-0000000004d2',
  name: 'Arben Kodra',
  shortName: 'Dr. Kodra',
  chairLabel: 'Chair 2',
  colorHue: 290,
};
const HYGIENIST: Provider = {
  ...DENTIST,
  id: '01970000-0000-7000-8000-0000000004d3',
  name: 'Vesna Lumi',
  shortName: 'Lumi',
  chairLabel: 'Chair 3',
  colorHue: 140,
};
/** Inactive, with nothing booked: no column on the day. */
const LEFT: Provider = { ...DENTIST, id: '01970000-0000-7000-8000-0000000004d4', active: false };

/** Today, a Monday in Skopje, open 08:00–18:00, with the three providers' columns. */
const TODAY: CalendarDayView = layoutDay({
  day: '2026-10-26',
  today: '2026-10-26',
  weekday: 1,
  hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
  closedDay: null,
  providers: [DENTIST, SECOND, HYGIENIST, LEFT],
  breaks: [],
  appointments: [],
});

function render(ownProviderId: string | null): string {
  const screen: ReactNode = createElement(CalendarScreen, {
    initial: { view: TODAY, ownProviderId },
    asked: null,
  });
  const frame: ComponentProps<typeof FrameClinic> = { clinicId: CLINIC, children: screen };
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(FrameClinic, frame),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The names of the columns drawn, in order. */
function columnNames(html: string): string[] {
  return [...html.matchAll(/id="calendar-column-[^"]+"[^>]*>([^<]*)</g)].map(
    ([, name]) => name ?? '',
  );
}

/** Each chip's text and pressed state. */
function chips(html: string): string[] {
  const group = html.match(/aria-label="Columns shown"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
  return [
    ...group.matchAll(/<button[^>]*aria-pressed="(\w+)"[^>]*>[\s\S]*?([^<>]+)<\/button>/g),
  ].map(([, pressed, name]) => `${name ?? ''}: ${pressed ?? ''}`);
}

describe('the columns a member opens on (acceptance 2)', () => {
  it('linked to a provider (the dentist, the hygienist): that column alone, the others off', () => {
    const dentist = render(DENTIST.id);
    expect(columnNames(dentist)).toEqual(['Elena Planinska']);
    expect(chips(dentist)).toEqual(['Dr. Planinska: true', 'Dr. Kodra: false', 'Lumi: false']);
    expect(dentist).toMatch(/>0 appointments · 1 chair</);

    const hygienist = render(HYGIENIST.id);
    expect(columnNames(hygienist)).toEqual(['Vesna Lumi']);
    expect(chips(hygienist)).toEqual(['Dr. Planinska: false', 'Dr. Kodra: false', 'Lumi: true']);
  });

  it('linked to no provider (the owner, the front desk): every column, every chip on', () => {
    const html = render(null);
    expect(columnNames(html)).toEqual(['Elena Planinska', 'Arben Kodra', 'Vesna Lumi']);
    expect(chips(html)).toEqual(['Dr. Planinska: true', 'Dr. Kodra: true', 'Lumi: true']);
  });

  it('linked to a provider without a column that day: every column', () => {
    expect(columnNames(render(LEFT.id))).toEqual(['Elena Planinska', 'Arben Kodra', 'Vesna Lumi']);
  });
});

describe('the "now" line on the server', () => {
  it('is not drawn: the browser draws it by its own clock once the page runs', () => {
    expect(render(null)).not.toContain('data-now-line');
  });
});
