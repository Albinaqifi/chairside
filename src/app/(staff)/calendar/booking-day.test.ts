import { describe, expect, it } from 'vitest';
import type { BookingChoices } from './booking-choices';
import { offeredOn } from './booking-day';
import { layoutDay, type CalendarDayView } from './day';

// E01-T06h: what the booking drawer offers on the day its Day field points at. Days are calendar
// dates and starts are minutes of the day, so no zone is involved.

const H = 60;
const DENTIST = '01970000-0000-7000-8000-0000000004a1';
const HYGIENIST = '01970000-0000-7000-8000-0000000004b2';

const CHOICES: BookingChoices = {
  day: '2026-10-26',
  today: '2026-10-26',
  starts: [8 * H, 8 * H + 15, 8 * H + 30, 9 * H],
  firstStart: 8 * H,
  providers: [
    { id: DENTIST, shortName: 'Dr. Planinska' },
    { id: HYGIENIST, shortName: 'Lumi' },
  ],
  firstProviderId: DENTIST,
  treatmentTypes: [],
};

/** A day with a narrower grid, 10:00 to 11:00, and only the hygienist active. */
const OTHER: CalendarDayView = layoutDay({
  day: '2026-11-23',
  today: '2026-10-26',
  weekday: 1,
  hours: [{ weekday: 1, opens: 10 * H, closes: 11 * H }],
  closedDay: null,
  providers: [
    {
      id: DENTIST,
      name: 'Elena Planinska',
      shortName: 'Dr. Planinska',
      chairLabel: 'Chair 1',
      colorHue: 195,
      active: false,
    },
    {
      id: HYGIENIST,
      name: 'Lumi Dimitrova',
      shortName: 'Lumi',
      chairLabel: 'Chair 2',
      colorHue: 30,
      active: true,
    },
  ],
  breaks: [],
  appointments: [],
});

describe('offeredOn', () => {
  it('on the day the drawer opened on: what it offered then, whatever a read says since', () => {
    const offered = offeredOn(
      CHOICES,
      '2026-10-26',
      { view: OTHER, state: 'ok' },
      9 * H,
      HYGIENIST,
    );
    expect(offered.starts).toEqual(CHOICES.starts);
    expect(offered.providers).toEqual(CHOICES.providers);
    expect(offered.providerId).toBe(HYGIENIST);
  });

  it('on another day that is known: its grid, its active providers, the time held among the starts', () => {
    const offered = offeredOn(
      CHOICES,
      '2026-11-23',
      { view: OTHER, state: 'ok' },
      9 * H + 10,
      DENTIST,
    );
    expect(offered.starts).toContain(9 * H + 10);
    expect(offered.starts).toContain(10 * H);
    expect(offered.starts).not.toContain(8 * H);
    expect([...offered.starts].sort((a, b) => a - b)).toEqual(offered.starts);
    expect(offered.providers.map((found) => found.id)).toEqual([HYGIENIST]);
  });

  it('the provider chosen is kept while the day offers them, else the first active one', () => {
    const known = { view: OTHER, state: 'ok' } as const;
    expect(offeredOn(CHOICES, '2026-11-23', known, 10 * H, HYGIENIST).providerId).toBe(HYGIENIST);
    expect(offeredOn(CHOICES, '2026-11-23', known, 10 * H, DENTIST).providerId).toBe(HYGIENIST);
  });

  it.each(['pending', 'failed'] as const)(
    'on another day that is not known (%s): what the drawer opened with, and the time held',
    (state) => {
      const offered = offeredOn(CHOICES, '2026-11-23', { view: OTHER, state }, 8 * H + 5, DENTIST);
      expect(offered.providers).toEqual(CHOICES.providers);
      expect(offered.providerId).toBe(DENTIST);
      expect(offered.starts).toEqual([8 * H, 8 * H + 5, 8 * H + 15, 8 * H + 30, 9 * H]);
    },
  );

  it('a day without an active provider offers none, and chooses none', () => {
    const closed = layoutDay({
      day: '2026-11-24',
      today: '2026-10-26',
      weekday: 2,
      hours: [],
      closedDay: null,
      providers: [],
      breaks: [],
      appointments: [],
    });
    const offered = offeredOn(CHOICES, '2026-11-24', { view: closed, state: 'ok' }, 9 * H, DENTIST);
    expect(offered.providers).toEqual([]);
    expect(offered.providerId).toBe('');
  });
});
