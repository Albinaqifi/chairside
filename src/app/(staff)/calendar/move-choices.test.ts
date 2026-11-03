import { describe, expect, it } from 'vitest';
import { firstMoveProvider, placeOf, pointedDay, startChoicesWith } from './move-choices';
import { layoutDay, type CalendarDayView, type Column } from './day';

// E01-T06f: what the appointment drawer's move form starts on and offers, without React. Each case that
// reads a clock names the zone it reads it in, never the computer's (CI runs once, in UTC: D-099). The
// form in a browser is in tests/e2e/appointment-move.spec.ts. Ids are made up.

const H = 60;

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
const LEFT = column('01970000-0000-7000-8000-0000000004d4', 'Kamenov', false);

function day(date: string): CalendarDayView {
  return layoutDay({
    day: date,
    today: '2026-10-26',
    weekday: 1,
    hours: [{ weekday: 1, opens: 8 * H, closes: 18 * H }],
    closedDay: null,
    providers: [],
    breaks: [],
    appointments: [],
  });
}

describe("the visit's own place: its day and minute in the clinic's zone, and its length", () => {
  it.each([
    ['Europe/Skopje', '2026-10-26', 9 * H],
    ['America/New_York', '2026-10-26', 4 * H],
    ['Pacific/Auckland', '2026-10-26', 21 * H],
  ])('in %s, 08:00 UTC is %s at minute %i', (timeZone, date, minute) => {
    const place = placeOf('2026-10-26T08:00:00.000Z', '2026-10-26T08:45:00.000Z', timeZone);
    expect(place).toEqual({ day: date, start: minute, length: 45 });
  });

  it('a visit late in the evening has its clinic day, not the UTC day', () => {
    // 23:30 on Monday in New York (UTC-4 on 26 October 2026) is 03:30 UTC on Tuesday.
    expect(
      placeOf('2026-10-27T03:30:00.000Z', '2026-10-27T04:30:00.000Z', 'America/New_York'),
    ).toEqual({ day: '2026-10-26', start: 23 * H + 30, length: 60 });
  });

  it('a visit across midnight starts on the day before the one a block of it can show', () => {
    expect(
      placeOf('2026-10-26T22:30:00.000Z', '2026-10-26T23:30:00.000Z', 'Europe/Skopje'),
    ).toEqual({ day: '2026-10-26', start: 23 * H + 30, length: 60 });
  });

  it('the length is real time on the day the clocks go back (Skopje, 25 October 2026)', () => {
    // 01:30 summer time (23:30 UTC) to 02:30 winter time (01:30 UTC): the clock's face says one hour,
    // two real hours pass.
    const place = placeOf('2026-10-24T23:30:00.000Z', '2026-10-25T01:30:00.000Z', 'Europe/Skopje');
    expect(place).toEqual({ day: '2026-10-25', start: 1 * H + 30, length: 120 });
  });

  it('a start that is no quarter hour keeps its minute', () => {
    expect(
      placeOf('2026-10-26T08:10:00.000Z', '2026-10-26T08:40:00.000Z', 'Europe/Skopje').start,
    ).toBe(9 * H + 10);
  });
});

describe('the starts offered: the grid, and the one held when no grid has it', () => {
  const grid = { from: 8 * H, to: 10 * H };

  it('the grid alone while the start is one of its quarter hours', () => {
    expect(startChoicesWith(grid, 9 * H)).toEqual([480, 495, 510, 525, 540, 555, 570, 585]);
  });

  it('adds a start that is no quarter hour, in its place', () => {
    const starts = startChoicesWith(grid, 9 * H + 10);
    expect(starts).toContain(9 * H + 10);
    expect(starts.indexOf(9 * H + 10)).toBe(starts.indexOf(9 * H) + 1);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("adds a start another day's grid does not run to, last or first", () => {
    expect(startChoicesWith(grid, 19 * H).at(-1)).toBe(19 * H);
    expect(startChoicesWith(grid, 6 * H)[0]).toBe(6 * H);
  });
});

describe('the provider the form starts on', () => {
  it("is the visit's own while that provider is active", () => {
    expect(firstMoveProvider([A, B], A)).toBe(A.providerId);
    expect(firstMoveProvider([A, B], B)).toBe(B.providerId);
  });

  it('is the first active provider when the visit’s own was made inactive', () => {
    expect(firstMoveProvider([LEFT, A, B], LEFT)).toBe(A.providerId);
  });

  it('is none for a clinic without an active provider', () => {
    expect(firstMoveProvider([LEFT], LEFT)).toBe('');
  });
});

describe("the day the form points at: the calendar's when it is that, else the last read", () => {
  const held = day('2026-10-26');
  const read = day('2026-10-28');
  const started = '2026-10-26';

  it('is the day the calendar holds, ready, whatever was read before', () => {
    expect(pointedDay('2026-10-26', held, null, started)).toEqual({ view: held, state: 'ok' });
    expect(pointedDay('2026-10-26', held, { day: '2026-10-28', view: read }, started)).toEqual({
      view: held,
      state: 'ok',
    });
  });

  it('keeps the calendar’s day while the first read of another is on its way', () => {
    expect(pointedDay('2026-10-28', held, null, started)).toEqual({ view: held, state: 'ok' });
  });

  it('is pending when the form started on a day the calendar does not hold', () => {
    // A visit across midnight, seen from the next day: its start is on the day before.
    expect(pointedDay('2026-10-25', held, null, '2026-10-25')).toEqual({
      view: held,
      state: 'pending',
    });
  });

  it('is the other day once it is read', () => {
    expect(pointedDay('2026-10-28', held, { day: '2026-10-28', view: read }, started)).toEqual({
      view: read,
      state: 'ok',
    });
  });

  it('keeps the last read until the next one comes', () => {
    expect(pointedDay('2026-10-29', held, { day: '2026-10-28', view: read }, started)).toEqual({
      view: read,
      state: 'ok',
    });
  });

  it('is failed when the read did not work, with the calendar’s day for the choices', () => {
    expect(pointedDay('2026-10-28', held, { day: '2026-10-28', view: null }, started)).toEqual({
      view: held,
      state: 'failed',
    });
  });
});
