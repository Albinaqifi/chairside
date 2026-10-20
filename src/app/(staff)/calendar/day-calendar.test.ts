import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '@/i18n/en.json';
import { LOCALE } from '@/i18n/locale';
import type { AppointmentStatus, DayAppointment, Provider } from '@/modules/scheduling';
import type { OpeningHours } from '@/modules/tenancy';
import { startChoices } from './booking-choices';
import { layoutDay, type CalendarDayView, type DayRows } from './day';
import {
  DayCalendar,
  dayHref,
  PX_PER_MINUTE,
  slotStart,
  type DayCalendarProps,
} from './day-calendar';

// E01-T04a: the calendar's day as the server sends it, with next-intl's provider as the root layout
// gives it: the message file and the clinic's zone (src/i18n/request.ts). Each case names the zone
// it renders in, never the computer's (CI runs once, in UTC: D-099). The views are laid out from
// rows as the read gives them (./day.ts); the read itself is tests/integration/calendar-day.test.ts.
// Names are from the seed's invented lists; ids are made up.

const H = 60;
const WEEKDAYS_8_TO_6: OpeningHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opens: 8 * H,
  closes: 18 * H,
}));

const PLANINSKA: Provider = {
  id: '01970000-0000-7000-8000-000000000101',
  name: 'Elena Planinska',
  shortName: 'Dr. Planinska',
  chairLabel: 'Chair 1',
  colorHue: 195,
  active: true,
};
const KODRA: Provider = {
  ...PLANINSKA,
  id: '01970000-0000-7000-8000-000000000102',
  name: 'Arben Kodra',
  chairLabel: 'Chair 2',
  colorHue: 290,
};

let nextId = 1;

/**
 * A visit of `minutes` from a local time: `at` is the moment it starts (UTC), `from` its minute on
 * the clinic's clock, as the read gives both.
 */
function visit(
  provider: Provider,
  at: string,
  from: number,
  minutes: number,
  status: AppointmentStatus = 'booked',
  fields: Partial<DayAppointment> = {},
): DayRows['appointments'][number] {
  const startsAt = new Date(at);
  return {
    id: `01970000-0000-7000-8000-0000000002${String(nextId++).padStart(2, '0')}`,
    providerId: provider.id,
    patientId: '01970000-0000-7000-8000-000000000301',
    title: 'Filling',
    status,
    note: '',
    startsAt,
    endsAt: new Date(startsAt.getTime() + minutes * 60_000),
    startMinute: from,
    endMinute: from + minutes,
    patient: { firstName: 'Ana', lastName: 'Brezovska' },
    ...fields,
  };
}

/** Monday 26 October 2026 at Harbour Street, in Skopje (UTC+1 since the night before). */
function monday(fields: Partial<DayRows> = {}): CalendarDayView {
  return layoutDay({
    day: '2026-10-26',
    today: '2026-10-26',
    weekday: 1,
    hours: WEEKDAYS_8_TO_6,
    closedDay: null,
    providers: [PLANINSKA],
    breaks: [],
    appointments: [],
    ...fields,
  });
}

function render(view: CalendarDayView, timeZone: string): string {
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone,
    children: createElement(DayCalendar, { view }),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The page's text without its tags, with the narrow spaces Intl puts before AM and PM as spaces. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/[\s ]+/g, ' ');
}

/** The attributes of each `tag` element in `html`, by name, as React writes them. */
function tags(html: string, tag: string): Map<string, string>[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, 'gi'))].map(([, inside = '']) => {
    const attributes = [...inside.matchAll(/([^\s"'>/=]+)(?:="([^"]*)")?/g)];
    return new Map(attributes.map(([, name = '', value = '']) => [name.toLowerCase(), value]));
  });
}

/** Each visit's block, by its status: its attributes, and its text. */
function blocks(html: string): { status: string; attributes: string; inside: string }[] {
  return [...html.matchAll(/<li([^>]*data-status="([a-z_]+)"[^>]*)>([\s\S]*?)<\/li>/g)].map(
    ([, attributes = '', status = '', inside = '']) => ({ status, attributes, inside }),
  );
}

describe('the title: the day, a date of the calendar, the same in every zone', () => {
  it.each(['Europe/Skopje', 'America/New_York', 'Pacific/Auckland', 'UTC'])(
    'in %s: Monday, October 26',
    (zone) => {
      const titles = tags(render(monday(), zone), 'h1');
      expect(titles).toHaveLength(1);
      expect(render(monday(), zone)).toMatch(/<h1[^>]*>Monday, October 26<\/h1>/);
    },
  );

  it('with its year when it is not in the clinic’s current year', () => {
    const later = layoutDay({ ...rowsOf(monday()), day: '2027-01-04', weekday: 1 });
    expect(render(later, 'America/New_York')).toMatch(/<h1[^>]*>Monday, January 4, 2027<\/h1>/);
  });
});

describe('Previous, Today and Next (acceptance 6)', () => {
  it('link to the day before, today and the day after; the address holds the day alone', () => {
    const links = tags(render(monday(), 'Europe/Skopje'), 'a');
    expect(links.map((link) => link.get('href'))).toEqual([
      '/calendar?day=2026-10-25',
      '/calendar',
      '/calendar?day=2026-10-27',
    ]);
    expect(links.map((link) => link.get('aria-label'))).toEqual([
      'Previous day',
      undefined,
      'Next day',
    ]);
    expect(render(monday(), 'Europe/Skopje')).toMatch(/<a[^>]*href="\/calendar"[^>]*>Today<\/a>/);
  });

  it('a day of the calendar is its address, with nothing but the day', () => {
    expect(dayHref('2026-12-31')).toBe('/calendar?day=2026-12-31');
  });
});

describe('the line under the title counts the appointments and the columns', () => {
  it('of every status, and every column', () => {
    const view = monday({
      providers: [PLANINSKA, KODRA],
      appointments: [
        visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 30, 'confirmed'),
        visit(KODRA, '2026-10-26T08:00:00Z', 9 * H, 30, 'cancelled'),
        visit(KODRA, '2026-10-26T09:00:00Z', 10 * H, 30, 'no_show'),
      ],
    });
    expect(text(render(view, 'Europe/Skopje'))).toContain(' 3 appointments · 2 chairs ');
  });

  it('one of each', () => {
    const view = monday({ appointments: [visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 30)] });
    expect(text(render(view, 'Europe/Skopje'))).toContain(' 1 appointment · 1 chair ');
  });
});

describe('a column per provider, its header as the demo draws it', () => {
  it('the initials in a circle of its tint, the name, the chair and % booked', () => {
    const view = monday({
      providers: [PLANINSKA, KODRA],
      appointments: [visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 180)],
    });
    const shown = text(render(view, 'Europe/Skopje'));
    expect(shown).toContain(' EP Elena Planinska Chair 1 · 30% booked ');
    expect(shown).toContain(' AK Arben Kodra Chair 2 · 0% booked ');
  });

  it("sets the provider's hue on its header and its column, which the theme's tints read", () => {
    const html = render(monday({ providers: [PLANINSKA, KODRA] }), 'Europe/Skopje');
    expect(html.match(/--provider-hue:195/g)).toHaveLength(2);
    expect(html.match(/--provider-hue:290/g)).toHaveLength(2);
  });

  it('a clinic without providers says each gets a column', () => {
    expect(text(render(monday({ providers: [] }), 'Europe/Skopje'))).toContain(
      'No providers yet. Each provider gets a column here.',
    );
  });
});

describe("each visit at its local start, as long as it lasts, its time in the clinic's zone (acceptance 1, 2)", () => {
  it('Skopje: 09:00 for half an hour, 87 px an hour from the 08:00 of the grid', () => {
    // 08:00 UTC on 26 October is 09:00 in Skopje, winter time from the night before.
    const view = monday({ appointments: [visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 30)] });
    const html = render(view, 'Europe/Skopje');
    const [block] = blocks(html);
    // One pixel under its start, three above its end (demo logic line 1821).
    expect(block?.attributes).toContain('top:88px;height:40.5px');
    expect(text(block?.inside ?? '')).toContain(' 09:00 Ana Brezovska ');
  });

  it('New York, behind UTC: a visit at 23:30 on its own day, at 23:30', () => {
    // 03:30 UTC on 9 March is 23:30 on 8 March in New York (daylight time since 02:00 that day).
    const view = layoutDay({
      ...rowsOf(monday()),
      day: '2026-03-08',
      today: '2026-03-08',
      weekday: 7,
      appointments: [visit(PLANINSKA, '2026-03-09T03:30:00Z', 23 * H + 30, 30)],
    });
    const html = render(view, 'America/New_York');
    expect(html).toMatch(/<h1[^>]*>Sunday, March 8<\/h1>/);
    const [block] = blocks(html);
    // The grid runs from 08:00 to midnight: 15.5 hours down.
    expect(block?.attributes).toContain(`top:${15.5 * 87 + 1}px`);
    expect(text(block?.inside ?? '')).toContain(' 23:30 Ana Brezovska ');
  });
});

describe('the hours of the grid', () => {
  it.each(['Europe/Skopje', 'America/New_York'])(
    'in %s: a label for each whole hour, from the grid’s first',
    (zone) => {
      // The 24-hour clock (E01-T04b, D-049): "08:00", as the format alone changed.
      const labels = [...render(monday(), zone).matchAll(/top:([\d.]+)px">(\d\d:\d\d)</g)].map(
        ([, top, label = '']) => `${label} at ${top}`,
      );
      expect(labels).toEqual([
        '08:00 at 0',
        '09:00 at 87',
        '10:00 at 174',
        '11:00 at 261',
        '12:00 at 348',
        '13:00 at 435',
        '14:00 at 522',
        '15:00 at 609',
        '16:00 at 696',
        '17:00 at 783',
      ]);
    },
  );
});

describe("a visit's look by its status, and its tag line (the demo's rule)", () => {
  const statuses: AppointmentStatus[] = [
    'booked',
    'confirmed',
    'arrived',
    'completed',
    'cancelled',
    'no_show',
  ];
  const view = monday({
    appointments: statuses.map((status, n) =>
      visit(
        PLANINSKA,
        `2026-10-26T${String(7 + n).padStart(2, '0')}:00:00Z`,
        (8 + n) * H,
        30,
        status,
      ),
    ),
  });
  const byStatus = new Map(blocks(render(view, 'Europe/Skopje')).map((b) => [b.status, b]));

  it('booked: tagged "Booked", in the booked colour, on the provider’s tint', () => {
    const block = byStatus.get('booked');
    expect(block?.attributes).toContain('bg-provider-tint');
    expect(block?.inside).toMatch(/<div class="[^"]*text-status-booked-fg[^"]*">Booked<\/div>/);
  });

  it('confirmed: plain, no tag; its status read out', () => {
    const block = byStatus.get('confirmed');
    expect(block?.attributes).toContain('bg-provider-tint');
    expect(block?.attributes).not.toMatch(/ring-2|opacity-60/);
    expect(block?.inside).toContain('<span class="sr-only">Confirmed</span>');
    expect(block?.inside).not.toMatch(/text-status-confirmed-fg/);
  });

  it('arrived: outlined in the provider’s strong tint, tagged "In the chair"', () => {
    const block = byStatus.get('arrived');
    expect(block?.attributes).toMatch(/ring-2 ring-provider-strong/);
    expect(block?.inside).toMatch(/>In the chair<\/div>/);
  });

  it('completed: faded, no tag; its status read out', () => {
    const block = byStatus.get('completed');
    expect(block?.attributes).toContain('opacity-60');
    expect(block?.inside).toContain('<span class="sr-only">Done</span>');
  });

  it.each([
    { status: 'cancelled', tag: 'Cancelled' },
    { status: 'no_show', tag: 'No-show' },
  ])('$status: struck through on red, tagged "$tag"', ({ status, tag }) => {
    const block = byStatus.get(status);
    expect(block?.attributes).toContain('bg-cancelled-block');
    expect(block?.attributes).toContain('border-cancelled-block-edge');
    expect(block?.attributes).not.toContain('bg-provider-tint');
    expect(block?.inside).toMatch(/<span class="[^"]*line-through[^"]*">Ana Brezovska<\/span>/);
    expect(block?.inside).toMatch(new RegExp(`>${tag}</div>`));
  });

  it('no name is struck through but a cancelled visit’s and a no-show’s', () => {
    for (const status of ['booked', 'confirmed', 'arrived', 'completed']) {
      expect(byStatus.get(status)?.inside, status).not.toContain('line-through');
    }
  });

  it('each shows its time, its patient and its title', () => {
    expect(text(byStatus.get('arrived')?.inside ?? '')).toContain(' 10:00 Ana Brezovska Filling ');
  });

  it('a note is the tag, whatever the status; the status is then read out', () => {
    const noted = monday({
      appointments: [
        visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 30, 'confirmed', {
          note: 'Bring the X-rays',
        }),
      ],
    });
    const [block] = blocks(render(noted, 'Europe/Skopje'));
    expect(block?.inside).toMatch(/text-status-confirmed-fg[^"]*">Bring the X-rays<\/div>/);
    expect(block?.inside).toContain('<span class="sr-only">Confirmed</span>');
  });
});

describe('two visits of one column that overlap sit side by side (acceptance 3)', () => {
  it('each in half the column, 3 px apart', () => {
    const view = monday({
      appointments: [
        visit(PLANINSKA, '2026-10-26T08:30:00Z', 9 * H + 30, 90),
        visit(PLANINSKA, '2026-10-26T09:00:00Z', 10 * H, 30, 'booked'),
      ],
    });
    const [first, second] = blocks(render(view, 'Europe/Skopje'));
    expect(first?.attributes).toContain(
      'left:calc(5px + (100% - 10px) * 0);width:calc((100% - 10px) / 2 - 3px)',
    );
    expect(second?.attributes).toContain(
      'left:calc(5px + (100% - 10px) * 0.5);width:calc((100% - 10px) / 2 - 3px)',
    );
  });

  it('a visit alone has the column’s width, 5 px in at each side', () => {
    const view = monday({ appointments: [visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 30)] });
    const [block] = blocks(render(view, 'Europe/Skopje'));
    expect(block?.attributes).toContain(
      'left:calc(5px + (100% - 10px) * 0);width:calc((100% - 10px) / 1)',
    );
  });
});

describe('breaks, the hours and a closed day (acceptance 1, 4)', () => {
  it('a break hatched, with its label, at its local time', () => {
    const view = monday({
      breaks: [
        {
          id: 'lunch',
          providerId: PLANINSKA.id,
          startMinute: 12 * H,
          endMinute: 13 * H,
          label: 'Lunch',
        },
      ],
    });
    const html = render(view, 'Europe/Skopje');
    const breaks = [...html.matchAll(/<li([^>]*data-break=""[^>]*)>([\s\S]*?)<\/li>/g)];
    expect(breaks).toHaveLength(1);
    expect(breaks[0]?.[1]).toContain('hatched');
    expect(breaks[0]?.[1]).toContain(`top:${4 * 87 + 1}px;height:${87 - 3}px`);
    expect(text(breaks[0]?.[2] ?? '')).toContain(' Lunch ');
  });

  it('time outside the day’s hours shaded in each column', () => {
    const view = monday({
      hours: [...WEEKDAYS_8_TO_6.slice(1), { weekday: 1, opens: 9 * H, closes: 17 * H }],
      providers: [PLANINSKA, KODRA],
    });
    const shaded = tags(render(view, 'Europe/Skopje'), 'div').filter((div) =>
      div.has('data-shaded'),
    );
    expect(shaded.map((div) => div.get('style'))).toEqual([
      'top:0px;height:87px',
      `top:${9 * 87}px;height:87px`,
      'top:0px;height:87px',
      `top:${9 * 87}px;height:87px`,
    ]);
  });

  it('a closed_days date says so with its label, is shaded whole, shows no % booked; its visit shows', () => {
    const view = monday({
      day: '2026-11-02',
      today: '2026-10-26',
      closedDay: { date: '2026-11-02', label: 'Staff training day' },
      appointments: [visit(PLANINSKA, '2026-11-02T08:00:00Z', 9 * H, 30)],
    });
    const html = render(view, 'Europe/Skopje');
    const shown = text(html);
    expect(shown).toContain(' Closed: Staff training day ');
    expect(shown).toContain(' EP Elena Planinska Chair 1 ');
    expect(shown).not.toContain('booked ');
    const shaded = tags(html, 'div').filter((div) => div.has('data-shaded'));
    expect(shaded.map((div) => div.get('style'))).toEqual([`top:0px;height:${10 * 87}px`]);
    expect(blocks(html)).toHaveLength(1);
  });

  it('a weekday without hours says so, with the weekday of the day in a zone behind UTC', () => {
    const view = monday({ day: '2026-10-31', weekday: 6 });
    expect(text(render(view, 'America/New_York'))).toContain(
      ' Closed: no opening hours on Saturday ',
    );
  });

  it('an open day says nothing of closing', () => {
    expect(text(render(monday(), 'Europe/Skopje'))).not.toContain('Closed');
  });
});

describe('the legend under the grid', () => {
  it('names each status with its dot', () => {
    const html = render(monday(), 'Europe/Skopje');
    const legend = html.match(/<ul aria-label="Statuses"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? '';
    expect(text(legend).trim()).toBe('Confirmed Booked In the chair Done Cancelled No-show');
    expect(legend.match(/bg-status-[a-z-]+-dot/g)).toEqual([
      'bg-status-confirmed-dot',
      'bg-status-booked-dot',
      'bg-status-arrived-dot',
      'bg-status-completed-dot',
      'bg-status-cancelled-dot',
      'bg-status-no-show-dot',
    ]);
  });
});

/** The rows a view was laid out from, enough to lay out another day of the same clinic. */
function rowsOf(view: CalendarDayView): DayRows {
  return {
    day: view.day,
    today: view.today,
    weekday: 1,
    hours: WEEKDAYS_8_TO_6,
    closedDay: null,
    providers: [PLANINSKA],
    breaks: [],
    appointments: [],
  };
}

// E01-T04b: what the browser's calendar (./calendar-screen.tsx) hands the day: the filter's choice
// and its chips, the "now" line's minute. Drawn here as the server draws them.

const LUMI: Provider = {
  ...PLANINSKA,
  id: '01970000-0000-7000-8000-000000000103',
  name: 'Vesna Lumi',
  shortName: 'Lumi',
  chairLabel: 'Chair 3',
  colorHue: 140,
};

function renderWith(props: Omit<DayCalendarProps, 'view'>, view: CalendarDayView): string {
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale: LOCALE,
    messages,
    timeZone: 'Europe/Skopje',
    children: createElement(DayCalendar, { view, ...props }),
  };
  return renderToString(createElement(NextIntlClientProvider, provider));
}

/** The filter's chips, each with its attributes and what it holds. */
function chipButtons(html: string): { attributes: string; inside: string }[] {
  const group = html.match(/<div role="group" aria-label="Columns shown"[^>]*>([\s\S]*?)<\/div>/);
  return [...(group?.[1] ?? '').matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(
    ([, attributes = '', inside = '']) => ({ attributes, inside }),
  );
}

/** Each chip of the filter: its pressed state and its text. */
function chips(html: string): { pressed: string | undefined; text: string }[] {
  return chipButtons(html).map(({ attributes, inside }) => ({
    pressed: attributes.match(/aria-pressed="(\w+)"/)?.[1],
    text: text(inside).trim(),
  }));
}

/** The names of the columns drawn, in order. */
function columnNames(html: string): string[] {
  return [...html.matchAll(/id="calendar-column-[^"]+"[^>]*>([^<]*)</g)].map(
    ([, name]) => name ?? '',
  );
}

describe('the provider filter: a chip per column of the day (E01-T04b)', () => {
  const three = monday({
    providers: [PLANINSKA, { ...KODRA, shortName: 'Dr. Kodra' }, LUMI],
    appointments: [
      visit(PLANINSKA, '2026-10-26T08:00:00Z', 9 * H, 30),
      visit(KODRA, '2026-10-26T08:00:00Z', 9 * H, 30, 'cancelled'),
      visit(KODRA, '2026-10-26T09:00:00Z', 10 * H, 30),
      visit(LUMI, '2026-10-26T10:00:00Z', 11 * H, 30),
    ],
  });
  const toggle = () => undefined;

  it("each the provider's short name, a button pressed when its column shows", () => {
    const html = renderWith({ shown: [PLANINSKA.id, LUMI.id], onToggle: toggle }, three);
    expect(chips(html)).toEqual([
      { pressed: 'true', text: 'Dr. Planinska' },
      { pressed: 'false', text: 'Dr. Kodra' },
      { pressed: 'true', text: 'Lumi' },
    ]);
    expect(chipButtons(html).every(({ attributes }) => attributes.includes('type="button"'))).toBe(
      true,
    );
  });

  it("a dot of the provider's strong tint, faded when off; the chip on the provider's tint when on", () => {
    const [on, off] = chipButtons(renderWith({ shown: [PLANINSKA.id], onToggle: toggle }, three));
    expect(on?.attributes).toContain('bg-provider-tint');
    expect(on?.attributes).toContain('--provider-hue:195');
    expect(on?.inside).toMatch(/<span aria-hidden="true" class="[^"]*bg-provider-strong"/);
    expect(off?.attributes).not.toContain('bg-provider-tint');
    expect(off?.attributes).toContain('text-muted');
    expect(off?.attributes).toContain('--provider-hue:290');
    expect(off?.inside).toMatch(/bg-provider-strong opacity-60/);
  });

  it('only the columns shown are drawn, in the day’s order', () => {
    const html = renderWith({ shown: [LUMI.id, PLANINSKA.id], onToggle: toggle }, three);
    expect(columnNames(html)).toEqual(['Elena Planinska', 'Vesna Lumi']);
    expect(text(html)).not.toContain('Arben Kodra');
  });

  it('the line under the title counts the columns shown and their appointments', () => {
    expect(text(renderWith({ shown: [KODRA.id], onToggle: toggle }, three))).toContain(
      ' 2 appointments · 1 chair ',
    );
    expect(text(renderWith({ shown: [PLANINSKA.id, LUMI.id], onToggle: toggle }, three))).toContain(
      ' 2 appointments · 2 chairs ',
    );
    expect(text(renderWith({ onToggle: toggle }, three))).toContain(' 4 appointments · 3 chairs ');
  });

  it('every column, and no chip, without a choice and a toggle', () => {
    const html = render(three, 'Europe/Skopje');
    expect(columnNames(html)).toEqual(['Elena Planinska', 'Arben Kodra', 'Vesna Lumi']);
    expect(chips(html)).toEqual([]);
  });

  it('a clinic without providers has no chips', () => {
    expect(chips(renderWith({ onToggle: toggle }, monday({ providers: [] })))).toEqual([]);
  });
});

describe('the "now" line (E01-T04b, demo lines 273–275)', () => {
  /** The line's attributes, if drawn. */
  const line = (html: string) => tags(html, 'div').find((div) => div.has('data-now-line')) ?? null;

  it('at its minute on the grid, 87 px an hour from the grid’s first, over the columns', () => {
    const at = line(renderWith({ nowMinute: 10 * H + 40 }, monday()));
    expect(at?.get('aria-hidden')).toBe('true');
    expect(at?.get('style')).toBe(`top:${(2 * H + 40) * 1.45}px`);
    expect(at?.get('class')).toContain('bg-now-line');
  });

  it('none without a minute: another day, outside the grid, or on the server', () => {
    expect(line(renderWith({ nowMinute: null }, monday()))).toBeNull();
    expect(line(render(monday(), 'Europe/Skopje'))).toBeNull();
  });

  it('none on a clinic without providers: no column to cross', () => {
    expect(line(renderWith({ nowMinute: 10 * H }, monday({ providers: [] })))).toBeNull();
  });
});

describe('a closed day shows no break and still its appointments (E01-T04b)', () => {
  const lunch = {
    id: 'lunch',
    providerId: PLANINSKA.id,
    startMinute: 12 * H,
    endMinute: 13 * H,
    label: 'Lunch',
  };

  it.each([
    {
      what: 'a closed_days date',
      fields: {
        day: '2026-11-02',
        closedDay: { date: '2026-11-02', label: 'Staff training day' },
        appointments: [visit(PLANINSKA, '2026-11-02T08:00:00Z', 9 * H, 30)],
      },
    },
    {
      what: 'a weekday without hours',
      fields: {
        day: '2026-10-31',
        weekday: 6,
        appointments: [visit(PLANINSKA, '2026-10-31T08:00:00Z', 10 * H, 30)],
      },
    },
  ])('$what', ({ fields }) => {
    const html = render(monday({ ...fields, breaks: [lunch] }), 'Europe/Skopje');
    expect(html).not.toContain('data-break');
    expect(text(html)).not.toContain(' Lunch ');
    expect(blocks(html)).toHaveLength(1);
  });

  it('an open day still shows its break', () => {
    expect(text(render(monday({ breaks: [lunch] }), 'Europe/Skopje'))).toContain(' Lunch ');
  });
});

describe('the 24-hour clock (E01-T04b, D-049): times of day, never the dates', () => {
  it.each([
    { zone: 'Europe/Skopje', at: '2026-10-26T13:30:00Z', from: 14 * H + 30, time: '14:30' },
    { zone: 'America/New_York', at: '2026-10-26T13:05:00Z', from: 9 * H + 5, time: '09:05' },
  ])('in $zone: $time; the title stays "Monday, October 26"', ({ zone, at, from, time }) => {
    const html = render(monday({ appointments: [visit(PLANINSKA, at, from, 30)] }), zone);
    expect(text(blocks(html)[0]?.inside ?? '')).toContain(` ${time} Ana Brezovska `);
    expect(html).toMatch(/<h1[^>]*>Monday, October 26<\/h1>/);
    expect(text(html)).not.toMatch(/\b[AP]M\b/);
  });
});

// E01-T05c: a click on an empty slot opens the booking drawer on that column's provider and the
// quarter hour under the pointer (the click itself, in three browsers: tests/e2e/booking.spec.ts).
describe('the quarter hour a click on an empty slot gives (E01-T05c, demo logic line 1819)', () => {
  const GRID = { from: 8 * H, to: 18 * H };
  /** The pixels of a quarter hour: 21.75. */
  const QUARTER = 15 * PX_PER_MINUTE;

  it("the quarter the pointer is in, counted from the grid's top", () => {
    expect(slotStart(0, GRID)).toBe(8 * H);
    expect(slotStart(QUARTER - 0.01, GRID)).toBe(8 * H);
    expect(slotStart(QUARTER, GRID)).toBe(8 * H + 15);
    // 10:37 is in the quarter from 10:30; 12:00 exactly is its own.
    expect(slotStart((10 * H + 37 - 8 * H) * PX_PER_MINUTE, GRID)).toBe(10 * H + 30);
    expect(slotStart(4 * 87, GRID)).toBe(12 * H);
    expect(slotStart(4 * 87 - 0.01, GRID)).toBe(11 * H + 45);
  });

  it("the grid's last quarter at its foot, and its first above its top", () => {
    const foot = (18 * H - 8 * H) * PX_PER_MINUTE;
    expect(slotStart(foot - 1, GRID)).toBe(17 * H + 45);
    expect(slotStart(foot, GRID)).toBe(17 * H + 45);
    expect(slotStart(foot + 40, GRID)).toBe(17 * H + 45);
    expect(slotStart(-3, GRID)).toBe(8 * H);
  });

  it('always a start the drawer offers, on a grid widened to the day’s blocks too', () => {
    for (const grid of [GRID, { from: 6 * H, to: 21 * H }]) {
      const starts = startChoices(grid);
      for (let offset = -10; offset < (grid.to - grid.from) * PX_PER_MINUTE + 10; offset += 3.3) {
        expect(starts).toContain(slotStart(offset, grid));
      }
      expect(slotStart(0, grid)).toBe(grid.from);
    }
  });
});

describe("the layer a click on an empty slot lands on: an active provider's column only (E01-T05c)", () => {
  /** Inactive, shown that day for a visit of theirs: no booking takes them (E01-T05a). */
  const LEFT: Provider = {
    ...LUMI,
    id: '01970000-0000-7000-8000-000000000104',
    name: 'Bojan Kamenov',
    shortName: 'B. Kamenov',
    active: false,
  };
  const day = monday({
    providers: [PLANINSKA, KODRA, LEFT],
    breaks: [
      {
        id: 'lunch',
        providerId: PLANINSKA.id,
        startMinute: 12 * H,
        endMinute: 13 * H,
        label: 'Lunch',
      },
    ],
    appointments: [
      visit(PLANINSKA, '2026-10-26T09:00:00Z', 10 * H, 30),
      visit(LEFT, '2026-10-26T10:00:00Z', 11 * H, 30),
    ],
  });
  const onSlot = () => undefined;

  /** The provider of each column drawn, in order, and whether it has the layer. */
  function columnsWithLayer(html: string): [string, boolean][] {
    return [
      ...html.matchAll(
        /(<div aria-hidden="true" data-slot-layer=""[^>]*><\/div>)?<ul aria-labelledby="calendar-column-([^"]+)"/g,
      ),
    ].map(([, layer, id = '']) => [id, layer !== undefined]);
  }

  it("in each active provider's column, none in an inactive provider's column (component)", () => {
    expect(columnsWithLayer(renderWith({ onSlot }, day))).toEqual([
      [PLANINSKA.id, true],
      [KODRA.id, true],
      [LEFT.id, false],
    ]);
  });

  it('none when the calendar takes no click on the grid', () => {
    const html = renderWith({}, day);
    expect(html).not.toContain('data-slot-layer');
    expect(columnsWithLayer(html)).toHaveLength(3);
  });

  it('hidden from a screen reader, reached by no key, with the copy cursor; under the blocks, which take the pointer back', () => {
    const html = renderWith({ onSlot }, day);
    const layers = tags(html, 'div').filter((div) => div.has('data-slot-layer'));
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.get('aria-hidden')).toBe('true');
      expect([layer.has('role'), layer.has('tabindex')]).toEqual([false, false]);
      expect(layer.get('class')?.split(' ')).toContain('cursor-copy');
    }
    // The blocks' list lets a pointer through to the layer; each block, a visit or a break, takes it.
    for (const list of tags(html, 'ul').filter((ul) => ul.has('aria-labelledby'))) {
      expect(list.get('class')?.split(' ')).toContain('pointer-events-none');
    }
    const blockItems = tags(html, 'li').filter(
      (li) => li.has('data-status') || li.has('data-break'),
    );
    expect(blockItems).toHaveLength(3);
    for (const item of blockItems) {
      expect(item.get('class')?.split(' ')).toContain('pointer-events-auto');
    }
  });
});
