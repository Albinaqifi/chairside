import { describe, expect, it } from 'vitest';
import type {
  AppointmentStatus,
  DayAppointment,
  Provider,
  ProviderBreak,
} from '@/modules/scheduling';
import type { ClosedDay, OpeningHours } from '@/modules/tenancy';
import { anyWarning, bookingWarnings, NO_WARNINGS } from './booking-warnings';
import { layoutDay, type CalendarDayView } from './day';

// E01-T05b: what the new-appointment drawer warns of above Book, without React: the day laid out by
// layoutDay from rows as the modules give them, in minutes of the day on the clinic's clock (Monday
// 26 October 2026 in Skopje, UTC+1). The drawer showing it is in new-appointment.test.ts, the browser
// in tests/e2e/booking.spec.ts. Names are from the seed's invented lists; ids are made up.

const H = 60;
const DENTIST = '01970000-0000-7000-8000-0000000004a1';
const HYGIENIST = '01970000-0000-7000-8000-0000000004b2';

/** 08:00 to 18:00, Monday to Friday, as the seed's clinics open. */
const WEEKDAYS_8_TO_6: OpeningHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opens: 8 * H,
  closes: 18 * H,
}));

function provider(id: string, shortName: string): Provider {
  return { id, name: shortName, shortName, chairLabel: 'Chair 1', colorHue: 195, active: true };
}

let nextId = 1;

/** A visit of the provider from `from` to `to`, minutes of the day. */
function visit(
  providerId: string,
  from: number,
  to: number,
  status: AppointmentStatus = 'booked',
): DayAppointment & { patient: { firstName: string; lastName: string } } {
  return {
    id: `01970000-0000-7000-8000-0000000002${String(nextId++).padStart(2, '0')}`,
    providerId,
    patientId: '01970000-0000-7000-8000-000000000301',
    title: 'Checkup',
    status,
    note: '',
    // Local midnight in Skopje that day is 23:00 UTC the day before.
    startsAt: new Date(Date.UTC(2026, 9, 25, 23, from)),
    endsAt: new Date(Date.UTC(2026, 9, 25, 23, to)),
    startMinute: from,
    endMinute: to,
    actions: [],
    movable: true,
    patient: { firstName: 'Ana', lastName: 'Brezovska' },
  };
}

function lunch(providerId: string, from: number, to: number): ProviderBreak {
  return {
    id: `${providerId}-lunch`,
    providerId,
    startMinute: from,
    endMinute: to,
    label: 'Lunch',
  };
}

/** Monday 26 October 2026 laid out: the dentist and the hygienist, with these rows. */
function monday(
  rows: {
    appointments?: ReturnType<typeof visit>[];
    breaks?: ProviderBreak[];
    closedDay?: ClosedDay | null;
    hours?: OpeningHours[];
  } = {},
): CalendarDayView {
  return layoutDay({
    day: '2026-10-26',
    today: '2026-10-26',
    weekday: 1,
    hours: rows.hours ?? WEEKDAYS_8_TO_6,
    closedDay: rows.closedDay ?? null,
    providers: [provider(DENTIST, 'Dr. Planinska'), provider(HYGIENIST, 'Lumi')],
    breaks: rows.breaks ?? [],
    appointments: rows.appointments ?? [],
  });
}

/** The ids of the visits a booking of the provider from `start` for `length` minutes overlaps. */
function overlapped(view: CalendarDayView, providerId: string, start: number, length: number) {
  return bookingWarnings(view, { providerId, start, length }).overlaps.map((block) => block.id);
}

describe('nothing to warn of', () => {
  it('inside the hours, on an open day, with nothing booked and no break', () => {
    const warnings = bookingWarnings(monday(), { providerId: DENTIST, start: 9 * H, length: 30 });
    expect(warnings).toEqual(NO_WARNINGS);
    expect(anyWarning(warnings)).toBe(false);
  });

  it('from the opening to the closing exactly: inside the hours', () => {
    expect(
      bookingWarnings(monday(), { providerId: DENTIST, start: 8 * H, length: 10 * H }).outsideHours,
    ).toBeNull();
  });
});

describe('an overlap: each visit of the provider the time overlaps that holds the chair (D-020)', () => {
  it('names the visit, and follows the start, the length and the provider', () => {
    const other = visit(DENTIST, 9 * H, 9 * H + 30);
    const view = monday({ appointments: [other] });
    // Over its start, its end, inside it, around it, at the same time.
    for (const [start, length] of [
      [8 * H + 45, 30],
      [9 * H + 15, 30],
      [9 * H + 5, 10],
      [8 * H + 50, 60],
      [9 * H, 30],
    ] as const) {
      expect(overlapped(view, DENTIST, start, length), `${start} for ${length}`).toEqual([
        other.id,
      ]);
    }
    // Back to back is no overlap; a shorter length ends before it; another provider is free then.
    expect(overlapped(view, DENTIST, 9 * H + 30, 30)).toEqual([]);
    expect(overlapped(view, DENTIST, 8 * H + 30, 30)).toEqual([]);
    expect(overlapped(view, DENTIST, 8 * H + 45, 15)).toEqual([]);
    expect(overlapped(view, HYGIENIST, 9 * H, 30)).toEqual([]);
  });

  it.each(['booked', 'confirmed', 'arrived', 'completed'] as const)(
    'a %s visit holds the chair',
    (status) => {
      const other = visit(DENTIST, 9 * H, 9 * H + 30, status);
      expect(overlapped(monday({ appointments: [other] }), DENTIST, 9 * H, 30)).toEqual([other.id]);
    },
  );

  it.each(['cancelled', 'no_show'] as const)('a %s visit frees its time', (status) => {
    const other = visit(DENTIST, 9 * H, 9 * H + 30, status);
    expect(overlapped(monday({ appointments: [other] }), DENTIST, 9 * H, 30)).toEqual([]);
  });

  it('every visit it overlaps, one booked anyway over another too, by start', () => {
    const first = visit(DENTIST, 9 * H, 10 * H);
    const anyway = visit(DENTIST, 9 * H + 30, 10 * H + 30);
    const later = visit(DENTIST, 11 * H, 11 * H + 30);
    const view = monday({ appointments: [anyway, later, first] });
    expect(overlapped(view, DENTIST, 9 * H + 45, 30)).toEqual([first.id, anyway.id]);
  });

  it('on a day the clinic is closed too: a visit there still holds the chair', () => {
    const other = visit(DENTIST, 9 * H, 9 * H + 30);
    const view = monday({
      appointments: [other],
      closedDay: { date: '2026-10-26', label: 'Staff training day' },
    });
    expect(overlapped(view, DENTIST, 9 * H, 30)).toEqual([other.id]);
  });

  it('a visit that began the day before and runs past midnight holds the chair from 00:00', () => {
    const night = visit(DENTIST, -30, 30);
    const view = monday({ appointments: [night] });
    expect(overlapped(view, DENTIST, 0, 15)).toEqual([night.id]);
    expect(overlapped(view, DENTIST, 30, 15)).toEqual([]);
  });

  it('no provider chosen (a clinic without one): nothing to overlap', () => {
    const view = monday({ appointments: [visit(DENTIST, 9 * H, 9 * H + 30)] });
    expect(bookingWarnings(view, { providerId: '', start: 9 * H, length: 30 })).toEqual(
      NO_WARNINGS,
    );
  });
});

describe('a break, the hours or a closed day (owner, D-114): each said, Book still books', () => {
  it("the provider's break: named while the time overlaps it, not another provider's", () => {
    const view = monday({
      breaks: [lunch(DENTIST, 12 * H, 13 * H), lunch(HYGIENIST, 13 * H, 14 * H)],
    });
    const inLunch = bookingWarnings(view, { providerId: DENTIST, start: 12 * H + 45, length: 30 });
    expect(inLunch.breaks.map((found) => [found.label, found.from, found.to])).toEqual([
      ['Lunch', 12 * H, 13 * H],
    ]);
    expect(inLunch.overlaps).toEqual([]);
    expect(anyWarning(inLunch)).toBe(true);
    // Before it, back to back; and the hygienist's lunch is later.
    expect(
      bookingWarnings(view, { providerId: DENTIST, start: 11 * H + 30, length: 30 }).breaks,
    ).toEqual([]);
    expect(
      bookingWarnings(view, { providerId: HYGIENIST, start: 12 * H, length: 60 }).breaks,
    ).toEqual([]);
  });

  it.each([
    ['starts before the opening', 7 * H + 45, 30],
    ['ends after the closing', 17 * H + 45, 30],
    ['lies after the closing', 18 * H, 30],
    ['lies before the opening', 7 * H, 30],
  ])('a time that %s: the day’s hours named', (_what, start, length) => {
    const warnings = bookingWarnings(monday(), { providerId: DENTIST, start, length });
    expect(warnings.outsideHours).toEqual({ from: 8 * H, to: 18 * H });
    expect(warnings.closed).toBeNull();
  });

  it('a closed day: its label, and no hours to run outside (no break is listed on it)', () => {
    const view = monday({
      breaks: [lunch(DENTIST, 12 * H, 13 * H)],
      closedDay: { date: '2026-10-26', label: 'Staff training day' },
    });
    const warnings = bookingWarnings(view, { providerId: DENTIST, start: 12 * H, length: 30 });
    expect(warnings).toEqual({
      overlaps: [],
      breaks: [],
      outsideHours: null,
      closed: { why: 'closed_day', label: 'Staff training day' },
    });
  });

  it('a weekday without hours: said so', () => {
    const view = monday({ hours: WEEKDAYS_8_TO_6.filter((found) => found.weekday !== 1) });
    expect(bookingWarnings(view, { providerId: DENTIST, start: 9 * H, length: 30 })).toEqual({
      ...NO_WARNINGS,
      closed: { why: 'no_hours' },
    });
  });

  it('an overlap, a break and the hours at once: each of them', () => {
    const other = visit(DENTIST, 17 * H, 18 * H + 30);
    const view = monday({ appointments: [other], breaks: [lunch(DENTIST, 17 * H + 30, 18 * H)] });
    const warnings = bookingWarnings(view, { providerId: DENTIST, start: 17 * H + 45, length: 30 });
    expect(warnings.overlaps.map((block) => block.id)).toEqual([other.id]);
    expect(warnings.breaks).toHaveLength(1);
    expect(warnings.outsideHours).toEqual({ from: 8 * H, to: 18 * H });
  });
});

describe("a visit left out (E01-T06f): the move form's own old place is no overlap", () => {
  it('leaves out the visit being moved, and still names every other', () => {
    const own = visit(DENTIST, 9 * H, 9 * H + 30);
    const next = visit(DENTIST, 9 * H + 30, 10 * H);
    const view = monday({ appointments: [own, next] });
    const moved = { providerId: DENTIST, start: 9 * H + 15, length: 30 };
    // Moving 09:00 to 09:15 overlaps its own old place and the visit after it.
    expect(bookingWarnings(view, moved).overlaps.map((block) => block.id)).toEqual([
      own.id,
      next.id,
    ]);
    expect(bookingWarnings(view, moved, own.id).overlaps.map((block) => block.id)).toEqual([
      next.id,
    ]);
  });

  it('leaves out nothing by default and for an id the day does not hold', () => {
    const own = visit(DENTIST, 9 * H, 9 * H + 30);
    const view = monday({ appointments: [own] });
    const booking = { providerId: DENTIST, start: 9 * H, length: 30 };
    expect(bookingWarnings(view, booking).overlaps).toHaveLength(1);
    expect(bookingWarnings(view, booking, null).overlaps).toHaveLength(1);
    expect(bookingWarnings(view, booking, 'no-such-visit').overlaps).toHaveLength(1);
  });

  it('leaves out the visit only: its break, the hours and the closed day still warn', () => {
    const own = visit(DENTIST, 12 * H, 12 * H + 30);
    const view = monday({ appointments: [own], breaks: [lunch(DENTIST, 12 * H, 13 * H)] });
    const warnings = bookingWarnings(
      view,
      { providerId: DENTIST, start: 12 * H, length: 30 },
      own.id,
    );
    expect(warnings.overlaps).toEqual([]);
    expect(warnings.breaks).toHaveLength(1);
    const closed = monday({
      closedDay: { date: '2026-10-26', label: 'Holiday' },
      appointments: [own],
    });
    expect(
      bookingWarnings(closed, { providerId: DENTIST, start: 9 * H, length: 30 }, own.id).closed,
    ).toEqual({ why: 'closed_day', label: 'Holiday' });
  });
});
