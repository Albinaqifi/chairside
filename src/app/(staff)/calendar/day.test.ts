import { describe, expect, it } from 'vitest';
import type {
  AppointmentStatus,
  DayAppointment,
  Provider,
  ProviderBreak,
} from '@/modules/scheduling';
import type { OpeningHours } from '@/modules/tenancy';
import {
  askedDay,
  gridSpan,
  initialsOf,
  isShownDay,
  layoutDay,
  outsideHours,
  percentBooked,
  placeInLanes,
  type AppointmentBlock,
  type DayRows,
  type Span,
} from './day';

// E01-T04a: the calendar's day laid out, without a database: every place is in minutes from the
// day's local midnight, as the scheduling and tenancy modules give them (their reads, in the
// clinic's zone on the days the clocks change, are in tests/integration/calendar-day.test.ts). Names
// are from the seed's invented lists; ids are made up.

const H = 60;

/** 08:00 to 18:00, Monday to Friday, as the seed's clinics open. */
const WEEKDAYS_8_TO_6: OpeningHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opens: 8 * H,
  closes: 18 * H,
}));

function provider(n: number, fields: Partial<Provider> = {}): Provider {
  return {
    id: `01970000-0000-7000-8000-00000000010${n}`,
    name: 'Elena Planinska',
    shortName: 'Dr. Planinska',
    chairLabel: `Chair ${n}`,
    colorHue: 195,
    active: true,
    ...fields,
  };
}

let nextId = 1;

function visit(
  providerId: string,
  from: number,
  to: number,
  status: AppointmentStatus = 'booked',
  fields: Partial<DayAppointment> = {},
): DayAppointment & { patient: { firstName: string; lastName: string } } {
  const id = `01970000-0000-7000-8000-0000000002${String(nextId++).padStart(2, '0')}`;
  return {
    id,
    providerId,
    patientId: '01970000-0000-7000-8000-000000000301',
    title: 'Checkup',
    status,
    note: '',
    // 26 October 2026 in Skopje (UTC+1): local midnight is 23:00 UTC the day before.
    startsAt: new Date(Date.UTC(2026, 9, 25, 23, from)),
    endsAt: new Date(Date.UTC(2026, 9, 25, 23, to)),
    startMinute: from,
    endMinute: to,
    patient: { firstName: 'Ana', lastName: 'Brezovska' },
    ...fields,
  };
}

function lunch(providerId: string, from = 12 * H, to = 13 * H): ProviderBreak {
  return {
    id: `${providerId}-lunch-${from}`,
    providerId,
    startMinute: from,
    endMinute: to,
    label: 'Lunch',
  };
}

/** A Monday of the seed's clinic: open 08:00–18:00, no closed day, one provider, nothing booked. */
function rows(fields: Partial<DayRows> = {}): DayRows {
  return {
    day: '2026-10-26',
    today: '2026-10-26',
    weekday: 1,
    hours: WEEKDAYS_8_TO_6,
    closedDay: null,
    providers: [provider(1)],
    breaks: [],
    appointments: [],
    ...fields,
  };
}

function appointmentBlocks(view: ReturnType<typeof layoutDay>, column = 0): AppointmentBlock[] {
  return (view.columns[column]?.blocks ?? []).filter(
    (block): block is AppointmentBlock => block.kind === 'appointment',
  );
}

describe('% booked (acceptance 5)', () => {
  const open: Span = { from: 8 * H, to: 18 * H }; // 600 minutes

  it('is 0 with no appointments', () => {
    expect(percentBooked(open, [], [])).toBe(0);
  });

  it('counts nothing for a cancelled visit or a no-show', () => {
    const visits = [
      { from: 9 * H, to: 10 * H, status: 'cancelled' as const },
      { from: 10 * H, to: 11 * H, status: 'no_show' as const },
    ];
    expect(percentBooked(open, visits, [])).toBe(0);
  });

  it('counts every status that holds the chair', () => {
    const statuses: AppointmentStatus[] = ['booked', 'confirmed', 'arrived', 'completed'];
    const visits = statuses.map((status, n) => ({
      from: (8 + n) * H,
      to: (8 + n) * H + 30,
      status,
    }));
    // 4 × 30 minutes of 600.
    expect(percentBooked(open, visits, [])).toBe(20);
  });

  it('counts the inside part of a visit partly outside the hours', () => {
    // 07:30–08:30: 30 minutes inside; 17:45–18:45: 15 minutes inside. 45 of 600 = 7.5 %.
    const visits = [
      { from: 7 * H + 30, to: 8 * H + 30, status: 'booked' as const },
      { from: 17 * H + 45, to: 18 * H + 45, status: 'booked' as const },
    ];
    expect(percentBooked(open, visits, [])).toBe(8);
    // Wholly outside: nothing.
    expect(percentBooked(open, [{ from: 6 * H, to: 7 * H, status: 'booked' }], [])).toBe(0);
  });

  it('takes a break out of the open time', () => {
    // 600 minutes less an hour's lunch: 540. A visit of 270 minutes is half of it.
    const visits = [{ from: 9 * H, to: 13 * H + 30, status: 'confirmed' as const }];
    expect(percentBooked(open, visits, [{ from: 12 * H, to: 13 * H }])).toBe(50);
  });

  it('counts the time two breaks share once, and a break only inside the hours', () => {
    // 12:00–13:00 and 12:30–13:30 cover 90 minutes; 07:00–08:30 takes 30 of the hours. 600 − 120.
    const breaks = [
      { from: 12 * H, to: 13 * H },
      { from: 12 * H + 30, to: 13 * H + 30 },
      { from: 7 * H, to: 8 * H + 30 },
    ];
    expect(percentBooked(open, [{ from: 9 * H, to: 13 * H, status: 'booked' }], breaks)).toBe(50);
  });

  it('may pass 100 when visits overlap', () => {
    const hour: Span = { from: 9 * H, to: 10 * H };
    const visits = [
      { ...hour, status: 'booked' as const },
      { ...hour, status: 'confirmed' as const },
    ];
    expect(percentBooked(hour, visits, [])).toBe(200);
  });

  it('rounds to a whole number', () => {
    // 200 of 600 minutes: 33.3 %.
    expect(percentBooked(open, [{ from: 8 * H, to: 8 * H + 200, status: 'booked' }], [])).toBe(33);
    // 203 of 600: 33.8 %.
    expect(percentBooked(open, [{ from: 8 * H, to: 8 * H + 203, status: 'booked' }], [])).toBe(34);
  });

  it('is none on a closed day', () => {
    expect(percentBooked(null, [{ from: 9 * H, to: 10 * H, status: 'booked' }], [])).toBeNull();
  });

  it('is none when breaks fill the hours: there is no open time to book', () => {
    expect(
      percentBooked({ from: 12 * H, to: 13 * H }, [], [{ from: 11 * H, to: 14 * H }]),
    ).toBeNull();
  });
});

describe('blocks that overlap sit side by side (acceptance 3)', () => {
  it('two that overlap: two lanes, one each', () => {
    const placed = placeInLanes([
      { from: 9 * H, to: 10 * H },
      { from: 9 * H + 30, to: 10 * H + 30 },
    ]);
    expect(placed.map(({ lane, lanes }) => ({ lane, lanes }))).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ]);
  });

  it('one that ends when the next starts does not overlap it', () => {
    const placed = placeInLanes([
      { from: 9 * H, to: 10 * H },
      { from: 10 * H, to: 11 * H },
    ]);
    expect(placed.map(({ lane, lanes }) => ({ lane, lanes }))).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it('a chain of overlaps shares its lanes; a block after it has the column to itself', () => {
    const placed = placeInLanes([
      { from: 9 * H, to: 10 * H }, // a
      { from: 9 * H + 30, to: 10 * H + 30 }, // b, over a
      { from: 10 * H + 10, to: 11 * H }, // c, over b only: a's lane is free again
      { from: 11 * H, to: 12 * H }, // d, after them
    ]);
    expect(placed.map(({ from, lane, lanes }) => ({ from, lane, lanes }))).toEqual([
      { from: 9 * H, lane: 0, lanes: 2 },
      { from: 9 * H + 30, lane: 1, lanes: 2 },
      { from: 10 * H + 10, lane: 0, lanes: 2 },
      { from: 11 * H, lane: 0, lanes: 1 },
    ]);
  });

  it('comes back by start, the longer first; the same span keeps its order', () => {
    const placed = placeInLanes([
      { from: 10 * H, to: 11 * H, name: 'late' },
      { from: 9 * H, to: 9 * H + 30, name: 'short' },
      { from: 9 * H, to: 10 * H, name: 'long' },
      { from: 9 * H, to: 10 * H, name: 'long, second' },
    ]);
    expect(placed.map((block) => block.name)).toEqual(['long', 'long, second', 'short', 'late']);
  });

  it('a visit booked anyway over another, and a cancelled one rebooked in its place: all show', () => {
    const p = provider(1);
    const rootCanal = visit(p.id, 9 * H + 30, 11 * H);
    const emergency = visit(p.id, 10 * H, 10 * H + 30); // booked anyway, over the root canal
    const cancelled = visit(p.id, 14 * H, 14 * H + 30, 'cancelled');
    const rebooked = visit(p.id, 14 * H, 14 * H + 30, 'confirmed');
    const view = layoutDay(rows({ appointments: [cancelled, rootCanal, rebooked, emergency] }));
    const placed = appointmentBlocks(view).map(({ id, lane, lanes }) => ({ id, lane, lanes }));
    expect(placed).toEqual([
      { id: rootCanal.id, lane: 0, lanes: 2 },
      { id: emergency.id, lane: 1, lanes: 2 },
      // The rebooked visit first, the one it replaced beside it.
      { id: rebooked.id, lane: 0, lanes: 2 },
      { id: cancelled.id, lane: 1, lanes: 2 },
    ]);
  });

  it('a visit over a break: both show, side by side', () => {
    const p = provider(1);
    const late = visit(p.id, 11 * H + 45, 12 * H + 30);
    const view = layoutDay(rows({ appointments: [late], breaks: [lunch(p.id)] }));
    expect(view.columns[0]?.blocks.map(({ kind, lane, lanes }) => ({ kind, lane, lanes }))).toEqual(
      [
        { kind: 'appointment', lane: 0, lanes: 2 },
        { kind: 'break', lane: 1, lanes: 2 },
      ],
    );
  });
});

describe('the hours the grid runs', () => {
  it("from the week's earliest opening to its latest closing, in whole hours", () => {
    const hours: OpeningHours[] = [
      { weekday: 1, opens: 8 * H + 30, closes: 16 * H },
      { weekday: 2, opens: 7 * H + 45, closes: 17 * H + 15 },
      { weekday: 6, opens: 9 * H, closes: 13 * H },
    ];
    expect(gridSpan(hours, [])).toEqual({ from: 7 * H, to: 18 * H });
  });

  it('08:00 to 18:00 when the clinic has no hours', () => {
    expect(gridSpan([], [])).toEqual({ from: 8 * H, to: 18 * H });
  });

  it("widened to the day's blocks outside them, to whole hours", () => {
    const blocks = [
      { from: 6 * H + 45, to: 7 * H + 15 },
      { from: 18 * H + 30, to: 19 * H + 10 },
    ];
    expect(gridSpan(WEEKDAYS_8_TO_6, blocks)).toEqual({ from: 6 * H, to: 20 * H });
    expect(gridSpan([], blocks)).toEqual({ from: 6 * H, to: 20 * H });
  });

  it('within the day: a visit from the evening before, or into the next morning', () => {
    expect(
      gridSpan(WEEKDAYS_8_TO_6, [
        { from: -30, to: 30 },
        { from: 23 * H + 30, to: 24 * H + 30 },
      ]),
    ).toEqual({ from: 0, to: 24 * H });
  });
});

describe('time outside the day’s hours is shaded (acceptance 4)', () => {
  it('before the opening and after the closing', () => {
    expect(outsideHours({ from: 9 * H, to: 17 * H }, { from: 8 * H, to: 18 * H })).toEqual([
      { from: 8 * H, to: 9 * H },
      { from: 17 * H, to: 18 * H },
    ]);
  });

  it('nothing when the day opens and closes with the grid', () => {
    expect(outsideHours({ from: 8 * H, to: 18 * H }, { from: 8 * H, to: 18 * H })).toEqual([]);
  });

  it('all of it on a closed day', () => {
    expect(outsideHours(null, { from: 8 * H, to: 18 * H })).toEqual([{ from: 8 * H, to: 18 * H }]);
  });

  it("from the day's own hours, on a grid of the week's", () => {
    const hours = [...WEEKDAYS_8_TO_6, { weekday: 6, opens: 9 * H, closes: 13 * H }];
    const saturday = layoutDay(rows({ day: '2026-10-31', weekday: 6, hours }));
    expect(saturday.open).toEqual({ from: 9 * H, to: 13 * H });
    expect(saturday.shaded).toEqual([
      { from: 8 * H, to: 9 * H },
      { from: 13 * H, to: 18 * H },
    ]);
  });
});

describe('a closed day (acceptance 4)', () => {
  it('a closed_days date: closed with its label, shaded whole, no % booked; its appointment still shows', () => {
    const p = provider(1);
    const booked = visit(p.id, 9 * H, 9 * H + 30);
    const view = layoutDay(
      rows({
        day: '2026-11-02',
        closedDay: { date: '2026-11-02', label: 'Staff training day' },
        appointments: [booked],
        breaks: [lunch(p.id)],
      }),
    );
    expect(view.closed).toEqual({ why: 'closed_day', label: 'Staff training day' });
    expect(view.open).toBeNull();
    expect(view.shaded).toEqual([view.grid]);
    expect(view.columns[0]?.percentBooked).toBeNull();
    expect(appointmentBlocks(view).map((block) => block.id)).toEqual([booked.id]);
  });

  it('a weekday without hours: closed, without a label', () => {
    const p = provider(1);
    const booked = visit(p.id, 10 * H, 10 * H + 45);
    const view = layoutDay(rows({ day: '2026-10-31', weekday: 6, appointments: [booked] }));
    expect(view.closed).toEqual({ why: 'no_hours' });
    expect(view.shaded).toEqual([{ from: 8 * H, to: 18 * H }]);
    expect(view.columns[0]?.percentBooked).toBeNull();
    expect(appointmentBlocks(view).map((block) => block.id)).toEqual([booked.id]);
  });

  it('an open day is not closed, and has its % booked', () => {
    const p = provider(1);
    const view = layoutDay(rows({ appointments: [visit(p.id, 9 * H, 12 * H)] }));
    expect(view.closed).toBeNull();
    expect(view.open).toEqual({ from: 8 * H, to: 18 * H });
    expect(view.columns[0]?.percentBooked).toBe(30);
  });
});

describe('the columns', () => {
  it('every active provider, in the order given; an inactive one only with an appointment that day', () => {
    const first = provider(1);
    const second = provider(2, { name: 'Arben Kodra', colorHue: 290 });
    const leftWithVisit = provider(3, { name: 'Mimoza Lumi', active: false });
    const leftWithout = provider(4, { name: 'Bojan Kamenov', active: false });
    const view = layoutDay(
      rows({
        providers: [first, second, leftWithVisit, leftWithout],
        appointments: [visit(leftWithVisit.id, 9 * H, 9 * H + 30, 'cancelled')],
        breaks: [lunch(first.id), lunch(leftWithout.id)],
      }),
    );
    expect(view.columns.map((column) => column.providerId)).toEqual([
      first.id,
      second.id,
      leftWithVisit.id,
    ]);
    expect(view.columns[1]).toMatchObject({ name: 'Arben Kodra', initials: 'AK', hue: 290 });
    // E01-T05a: whether a booking can take the column's provider.
    expect(view.columns.map((column) => column.active)).toEqual([true, true, false]);
  });

  it("each with its own appointments and its breaks of the day's weekday", () => {
    const first = provider(1);
    const second = provider(2);
    const own = visit(first.id, 9 * H, 9 * H + 30);
    const other = visit(second.id, 9 * H, 9 * H + 30);
    const view = layoutDay(
      rows({
        providers: [first, second],
        appointments: [own, other],
        breaks: [lunch(second.id, 13 * H, 14 * H)],
      }),
    );
    expect(view.columns[0]?.blocks.map((block) => block.id)).toEqual([own.id]);
    expect(view.columns[1]?.blocks.map((block) => block.kind)).toEqual(['appointment', 'break']);
    expect(view.columns[1]?.blocks[1]).toMatchObject({ label: 'Lunch', from: 13 * H, to: 14 * H });
  });

  it('a block that runs past midnight is cut at the edge of the grid', () => {
    const p = provider(1);
    const evening = visit(p.id, 23 * H + 30, 24 * H + 30);
    const view = layoutDay(rows({ appointments: [evening] }));
    expect(view.grid).toEqual({ from: 8 * H, to: 24 * H });
    expect(appointmentBlocks(view)[0]).toMatchObject({ from: 23 * H + 30, to: 24 * H });
  });

  it('counts every appointment of the day, whatever its status', () => {
    const p = provider(1);
    const statuses: AppointmentStatus[] = [
      'booked',
      'confirmed',
      'arrived',
      'completed',
      'cancelled',
      'no_show',
    ];
    const view = layoutDay(
      rows({
        appointments: statuses.map((status, n) =>
          visit(p.id, (8 + n) * H, (8 + n) * H + 30, status),
        ),
      }),
    );
    expect(view.appointmentCount).toBe(6);
  });

  it('gives the day before and the day after, across a month and a year', () => {
    expect(layoutDay(rows({ day: '2026-12-31', weekday: 4 }))).toMatchObject({
      previous: '2026-12-30',
      next: '2027-01-01',
    });
    expect(layoutDay(rows({ day: '2028-03-01', weekday: 3 }))).toMatchObject({
      previous: '2028-02-29',
      next: '2028-03-02',
    });
  });
});

describe('initials: the first letters of the first and last words of the name', () => {
  it.each([
    { name: 'Elena Planinska', initials: 'EP' },
    { name: 'Љубица Ќошкова', initials: 'ЉЌ' },
    { name: 'Ana Maria Lumi', initials: 'AL' },
    { name: '  arben   kodra ', initials: 'AK' },
    { name: 'Mimoza', initials: 'M' },
    { name: '', initials: '' },
  ])('$name: $initials', ({ name, initials }) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe('the day the address asks for (acceptance 6)', () => {
  it.each(['2026-10-26', '2028-02-29', '0001-01-01', '9999-12-31'])('%s: that day', (day) => {
    expect(askedDay(day)).toBe(day);
    expect(isShownDay(day)).toBe(true);
  });

  it.each([
    { what: 'nothing', value: undefined },
    { what: 'empty', value: '' },
    { what: 'a day the month lacks', value: '2026-02-30' },
    { what: 'a word', value: 'today' },
    { what: 'with a time', value: '2026-10-26T09:00' },
    { what: 'with spaces', value: ' 2026-10-26' },
    { what: 'another order', value: '26-10-2026' },
    { what: 'the year 0, which PostgreSQL lacks', value: '0000-12-31' },
    { what: 'two days', value: ['2026-10-26', '2026-10-27'] },
  ])('$what: today', ({ value }) => {
    expect(askedDay(value)).toBeNull();
  });
});

// E01-T04b: no break on a closed day (owner, 2026-10-12): the clinic is closed, so no lunch shows,
// while its appointments still do; the grid is then not widened to a break either.
describe('no break on a closed day (E01-T04b)', () => {
  const breakBlocks = (view: ReturnType<typeof layoutDay>) =>
    view.columns.flatMap((column) => column.blocks.filter((block) => block.kind === 'break'));

  it('a closed_days date: no break in any column; its appointment still shows', () => {
    const [p, q] = [provider(1), provider(2)];
    const booked = visit(p.id, 9 * H, 9 * H + 30);
    const view = layoutDay(
      rows({
        day: '2026-11-02',
        closedDay: { date: '2026-11-02', label: 'Staff training day' },
        providers: [p, q],
        appointments: [booked],
        breaks: [lunch(p.id), lunch(q.id, 13 * H, 14 * H)],
      }),
    );
    expect(breakBlocks(view)).toEqual([]);
    expect(appointmentBlocks(view).map((block) => block.id)).toEqual([booked.id]);
  });

  it('a weekday without hours: no break; its appointment still shows', () => {
    const p = provider(1);
    const booked = visit(p.id, 10 * H, 10 * H + 45);
    const view = layoutDay(
      rows({ day: '2026-10-31', weekday: 6, appointments: [booked], breaks: [lunch(p.id)] }),
    );
    expect(view.closed).toEqual({ why: 'no_hours' });
    expect(breakBlocks(view)).toEqual([]);
    expect(appointmentBlocks(view).map((block) => block.id)).toEqual([booked.id]);
  });

  it('a break outside the hours no longer widens the grid of a closed day', () => {
    const p = provider(1);
    const view = layoutDay(
      rows({
        day: '2026-11-02',
        closedDay: { date: '2026-11-02', label: 'Staff training day' },
        breaks: [lunch(p.id, 19 * H, 20 * H)],
      }),
    );
    expect(view.grid).toEqual({ from: 8 * H, to: 18 * H });
  });

  it('an open day keeps its breaks', () => {
    const p = provider(1);
    const view = layoutDay(rows({ breaks: [lunch(p.id)] }));
    expect(breakBlocks(view).map((block) => [block.from, block.to])).toEqual([[12 * H, 13 * H]]);
  });
});

describe("a column's short name, its chip in the filter (E01-T04b)", () => {
  it("is the provider's short_name", () => {
    const view = layoutDay(
      rows({ providers: [provider(1), provider(2, { name: 'Arben Kodra', shortName: 'Kodra' })] }),
    );
    expect(view.columns.map((column) => column.shortName)).toEqual(['Dr. Planinska', 'Kodra']);
  });
});
