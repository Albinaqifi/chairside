import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ComponentProps } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '@/i18n/en.json';
import type { AppointmentStatus, DayAppointment, Provider } from '@/modules/scheduling';
import type { OpeningHours } from '@/modules/tenancy';
import { layoutDay, type CalendarDayView, type DayRows } from './day';
import { DayCalendar, dayHref } from './day-calendar';

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
    locale: 'en',
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
    expect(text(block?.inside ?? '')).toContain(' 9:00 AM Ana Brezovska ');
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
    expect(text(block?.inside ?? '')).toContain(' 11:30 PM Ana Brezovska ');
  });
});

describe('the hours of the grid', () => {
  it.each(['Europe/Skopje', 'America/New_York'])(
    'in %s: a label for each whole hour, from the grid’s first',
    (zone) => {
      // The space before AM or PM may be a narrow one, as some versions of Intl write it.
      const labels = [...render(monday(), zone).matchAll(/top:([\d.]+)px">(\d+\s[AP]M)</g)].map(
        ([, top, label = '']) => `${label.replace(/\s/, ' ')} at ${top}`,
      );
      expect(labels).toEqual([
        '8 AM at 0',
        '9 AM at 87',
        '10 AM at 174',
        '11 AM at 261',
        '12 PM at 348',
        '1 PM at 435',
        '2 PM at 522',
        '3 PM at 609',
        '4 PM at 696',
        '5 PM at 783',
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
    expect(text(byStatus.get('arrived')?.inside ?? '')).toContain(
      ' 10:00 AM Ana Brezovska Filling ',
    );
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
