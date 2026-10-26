import { describe, expect, it } from 'vitest';
import type { TreatmentType } from '@/modules/scheduling';
import {
  bookableProviders,
  bookingChoices,
  clinicNow,
  firstProvider,
  firstStart,
  FIRST_LENGTH,
  lengthChoices,
  LENGTHS,
  minutesOfStart,
  startChoices,
  startValue,
} from './booking-choices';
import { layoutDay, type Column } from './day';

// E01-T05a: what the new-appointment drawer offers and what it begins with, without React. Each case
// that reads a clock names the zone it reads it in, never the computer's (CI runs once, in UTC:
// D-099). The drawer in a browser is in tests/e2e/booking.spec.ts. Ids are made up.

const H = 60;
const OPEN_8_TO_6 = { from: 8 * H, to: 18 * H };

function column(providerId: string, shortName: string, active = true): Column {
  return {
    providerId,
    name: shortName,
    shortName,
    initials: shortName.slice(0, 2).toUpperCase(),
    chairLabel: 'Chair 1',
    hue: 195,
    active,
    percentBooked: null,
    blocks: [],
  };
}

const A = column('01970000-0000-7000-8000-0000000004a1', 'Dr. Planinska');
const B = column('01970000-0000-7000-8000-0000000004b2', 'Dr. Kodra');
const C = column('01970000-0000-7000-8000-0000000004c3', 'Lumi');
/** Inactive, shown that day for a visit of theirs. */
const LEFT = column('01970000-0000-7000-8000-0000000004d4', 'Kamenov', false);

describe("a start's value: HH:MM", () => {
  it('minutes from midnight as HH:MM, and back', () => {
    expect([0, 9 * H, 10 * H + 30, 23 * H + 45].map(startValue)).toEqual([
      '00:00',
      '09:00',
      '10:30',
      '23:45',
    ]);
    expect(['00:00', '09:00', '10:30', '23:59'].map(minutesOfStart)).toEqual([
      0,
      9 * H,
      10 * H + 30,
      23 * H + 59,
    ]);
  });

  it('anything else is no start', () => {
    for (const value of ['', '9:00', '24:00', '09:60', '0900', '09:00:00', ' 09:00', 'nine']) {
      expect(minutesOfStart(value), value).toBeNull();
    }
  });
});

describe('the starts offered: each quarter hour of the grid', () => {
  it('from its start up to its last quarter, not its end', () => {
    const starts = startChoices({ from: 8 * H, to: 18 * H });
    expect(starts).toHaveLength(40);
    expect(starts.slice(0, 3)).toEqual([8 * H, 8 * H + 15, 8 * H + 30]);
    expect(starts.at(-1)).toBe(17 * H + 45);
  });

  it('a whole day: 00:00 to 23:45', () => {
    const starts = startChoices({ from: 0, to: 24 * H });
    expect(starts).toHaveLength(96);
    expect([starts[0], starts.at(-1)]).toEqual([0, 23 * H + 45]);
  });
});

describe('the start a booking begins with', () => {
  const MONDAY = '2026-10-26';
  const day = (open: { from: number; to: number } | null = OPEN_8_TO_6) => ({
    day: MONDAY,
    open,
    grid: { from: 8 * H, to: 18 * H },
  });
  const at = (minute: number) => ({ day: MONDAY, minute });

  it('another day than the clinic’s today: the day’s opening', () => {
    expect(firstStart(day(), { day: '2026-10-25', minute: 10 * H })).toBe(8 * H);
    expect(firstStart(day(), null)).toBe(8 * H);
  });

  it('on today, the next quarter hour after the clinic’s now', () => {
    expect(firstStart(day(), at(10 * H + 7))).toBe(10 * H + 15);
    expect(firstStart(day(), at(10 * H + 14))).toBe(10 * H + 15);
    // After now: at 10:15 itself, 10:30.
    expect(firstStart(day(), at(10 * H + 15))).toBe(10 * H + 30);
    expect(firstStart(day(), at(17 * H + 44))).toBe(17 * H + 45);
  });

  it('on today, before the day’s hours or once that quarter is past them: the day’s opening', () => {
    expect(firstStart(day(), at(6 * H + 50))).toBe(8 * H);
    expect(firstStart(day(), at(7 * H + 50))).toBe(8 * H); // the next quarter is the opening itself
    expect(firstStart(day(), at(17 * H + 45))).toBe(8 * H); // 18:00 is no start inside the hours
    expect(firstStart(day(), at(21 * H))).toBe(8 * H);
  });

  it('a closed day: the grid’s start, today or not', () => {
    expect(firstStart(day(null), at(10 * H))).toBe(8 * H);
    expect(firstStart(day(null), null)).toBe(8 * H);
  });

  it('an opening between two quarters begins at the next quarter; none past the grid', () => {
    expect(firstStart({ ...day({ from: 8 * H + 10, to: 18 * H }) }, null)).toBe(8 * H + 15);
    expect(firstStart({ ...day({ from: 17 * H + 50, to: 18 * H }) }, null)).toBe(17 * H + 45);
  });
});

describe("the clinic's now, by the browser's clock in the clinic's zone", () => {
  it.each([
    // 23:30 UTC on 25 October 2026: already the 26th in Skopje (UTC+1), still the 25th in New York.
    { zone: 'Europe/Skopje', at: '2026-10-25T23:30:00Z', day: '2026-10-26', minute: 0 * H + 30 },
    {
      zone: 'America/New_York',
      at: '2026-10-25T23:30:00Z',
      day: '2026-10-25',
      minute: 19 * H + 30,
    },
    // The days the clocks change: the minute on the wall clock, as the calendar's blocks are placed.
    { zone: 'Europe/Skopje', at: '2026-03-29T08:00:00Z', day: '2026-03-29', minute: 10 * H },
    { zone: 'America/New_York', at: '2026-11-01T15:00:00Z', day: '2026-11-01', minute: 10 * H },
  ])('$zone at $at: $day, minute $minute', ({ zone, at, day, minute }) => {
    expect(clinicNow(new Date(at), zone)).toEqual({ day, minute });
  });
});

describe('the lengths offered', () => {
  it('15, 30, 45, 60, 90 and 120 minutes; 30 before a treatment is picked', () => {
    expect(lengthChoices()).toEqual([15, 30, 45, 60, 90, 120]);
    expect(lengthChoices(null)).toEqual([...LENGTHS]);
    expect(FIRST_LENGTH).toBe(30);
  });

  it("and the treatment's own, in order, once", () => {
    expect(lengthChoices(50)).toEqual([15, 30, 45, 50, 60, 90, 120]);
    expect(lengthChoices(45)).toEqual([15, 30, 45, 60, 90, 120]);
    expect(lengthChoices(180, 50)).toEqual([15, 30, 45, 50, 60, 90, 120, 180]);
  });
});

describe('the providers offered, and the one a booking begins with', () => {
  it('the active ones, in the calendar’s order', () => {
    expect(bookableProviders([A, LEFT, B, C])).toEqual([
      { id: A.providerId, shortName: 'Dr. Planinska' },
      { id: B.providerId, shortName: 'Dr. Kodra' },
      { id: C.providerId, shortName: 'Lumi' },
    ]);
  });

  it('first the first column shown, when its provider is active', () => {
    expect(firstProvider([A, B, C], [A.providerId, B.providerId, C.providerId])).toBe(A.providerId);
    // The hygienist's own column alone (E01-T04b): the hygienist.
    expect(firstProvider([A, B, C], [C.providerId])).toBe(C.providerId);
  });

  it('else the next column shown that is active, else the first active provider, else none', () => {
    expect(firstProvider([LEFT, A, B], [LEFT.providerId, B.providerId])).toBe(B.providerId);
    expect(firstProvider([LEFT, A, B], [LEFT.providerId])).toBe(A.providerId);
    expect(firstProvider([LEFT], [LEFT.providerId])).toBeNull();
    expect(firstProvider([], [])).toBeNull();
  });
});

describe("the drawer's choices, read when it opens", () => {
  const CHECKUP: TreatmentType = {
    id: '01970000-0000-7000-8000-000000000601',
    name: 'Checkup',
    minutes: 30,
  };

  it('the day shown, its quarter hours, the first start, the active providers, the treatment types', () => {
    const view = layoutDay({
      day: '2026-10-26',
      today: '2026-10-26',
      weekday: 1,
      hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
      closedDay: null,
      providers: [
        {
          id: A.providerId,
          name: 'Elena Planinska',
          shortName: 'Dr. Planinska',
          chairLabel: 'Chair 1',
          colorHue: 195,
          active: true,
        },
        {
          id: B.providerId,
          name: 'Arben Kodra',
          shortName: 'Dr. Kodra',
          chairLabel: 'Chair 2',
          colorHue: 290,
          active: true,
        },
      ],
      breaks: [],
      appointments: [],
    });
    const choices = bookingChoices(view, [CHECKUP], [B.providerId], {
      day: '2026-10-26',
      minute: 9 * H + 50,
    });
    expect(choices).toEqual({
      day: '2026-10-26',
      today: '2026-10-26',
      starts: startChoices({ from: 8 * H, to: 18 * H }),
      firstStart: 10 * H,
      providers: [
        { id: A.providerId, shortName: 'Dr. Planinska' },
        { id: B.providerId, shortName: 'Dr. Kodra' },
      ],
      firstProviderId: B.providerId,
      treatmentTypes: [CHECKUP],
    });
  });
});

// E01-T05c: a click on an empty slot of the grid opens the drawer with the slot's start and provider
// in place of the first ones (the quarter hour under the pointer: day-calendar.test.ts).
describe('the drawer opened on an empty slot of the grid', () => {
  /** Monday 26 October 2026, open 08:00–18:00, with A and B active and LEFT shown for a visit. */
  const VIEW = {
    ...layoutDay({
      day: '2026-10-26',
      today: '2026-10-26',
      weekday: 1,
      hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
      closedDay: null,
      providers: [],
      breaks: [],
      appointments: [],
    }),
    columns: [A, B, LEFT],
  };
  const NOW = { day: '2026-10-26', minute: 9 * H + 50 };

  it("begins on the slot's start and provider, whatever the clock and the columns shown say", () => {
    const choices = bookingChoices(VIEW, [], [A.providerId], NOW, {
      providerId: B.providerId,
      start: 14 * H + 45,
    });
    expect([choices.firstStart, choices.firstProviderId]).toEqual([14 * H + 45, B.providerId]);
    // What it offers is New appointment's: every quarter of the grid, the active providers.
    expect(choices).toEqual({
      ...bookingChoices(VIEW, [], [A.providerId], NOW),
      firstStart: 14 * H + 45,
      firstProviderId: B.providerId,
    });
  });

  it("the grid's first and last quarter, and a quarter outside the day's hours, are starts it offers", () => {
    for (const start of [8 * H, 17 * H + 45]) {
      expect(
        bookingChoices(VIEW, [], [], NOW, { providerId: A.providerId, start }).firstStart,
      ).toBe(start);
    }
    const closed = { ...VIEW, closed: { why: 'no_hours' as const }, open: null };
    expect(
      bookingChoices(closed, [], [], NOW, { providerId: A.providerId, start: 9 * H + 15 })
        .firstStart,
    ).toBe(9 * H + 15);
  });

  it('a slot it does not offer begins on the first one instead: an inactive provider, a time off the grid', () => {
    const first = bookingChoices(VIEW, [], [B.providerId], NOW);
    const inactive = bookingChoices(VIEW, [], [B.providerId], NOW, {
      providerId: LEFT.providerId,
      start: 11 * H,
    });
    expect([inactive.firstStart, inactive.firstProviderId]).toEqual([
      11 * H,
      first.firstProviderId,
    ]);
    for (const start of [7 * H + 45, 18 * H, 9 * H + 10]) {
      expect(
        bookingChoices(VIEW, [], [], NOW, { providerId: A.providerId, start }).firstStart,
        String(start),
      ).toBe(first.firstStart);
    }
  });
});
