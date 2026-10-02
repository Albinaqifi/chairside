import { describe, expect, it } from 'vitest';
import { fakeClock, systemClock } from './clock';

describe('fakeClock', () => {
  it('returns the start time and stands still', () => {
    const clock = fakeClock('2026-03-10T09:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-03-10T09:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-03-10T09:00:00.000Z');
  });

  it('accepts a Date and ISO strings with an offset', () => {
    expect(fakeClock(new Date('2026-03-10T09:00:00Z')).now().toISOString()).toBe(
      '2026-03-10T09:00:00.000Z',
    );
    expect(fakeClock('2026-03-10T10:00:00+01:00').now().toISOString()).toBe(
      '2026-03-10T09:00:00.000Z',
    );
  });

  it('moves forward and back with advance', () => {
    const clock = fakeClock('2026-03-10T09:00:00Z');
    clock.advance(90 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-03-10T10:30:00.000Z');
    clock.advance(-30 * 60_000);
    expect(clock.now().toISOString()).toBe('2026-03-10T10:00:00.000Z');
  });

  it('jumps to a moment with set', () => {
    const clock = fakeClock('2026-03-10T09:00:00Z');
    clock.set('2026-12-31T23:59:59Z');
    expect(clock.now().toISOString()).toBe('2026-12-31T23:59:59.000Z');
  });

  it('hands out copies, so changing a returned Date does not move the clock', () => {
    const clock = fakeClock('2026-03-10T09:00:00Z');
    clock.now().setUTCFullYear(1999);
    expect(clock.now().toISOString()).toBe('2026-03-10T09:00:00.000Z');
  });

  it('rejects times without a zone, which would depend on the machine running the test', () => {
    expect(() => fakeClock('2026-03-10T09:00:00')).toThrow(RangeError);
    expect(() => fakeClock('2026-03-10')).toThrow(RangeError);
  });

  it('rejects invalid input', () => {
    expect(() => fakeClock('2026-13-45T09:00:00Z')).toThrow(RangeError);
    expect(() => fakeClock(new Date(Number.NaN))).toThrow(RangeError);
    expect(() => fakeClock('2026-03-10T09:00:00Z').advance(Number.NaN)).toThrow(RangeError);
  });

  it('rejects a day its month does not have, instead of moving into the next month', () => {
    // JavaScript reads 2026-02-30 as 2 March. A timing test must not run on a date it did not ask for.
    expect(() => fakeClock('2026-02-30T09:00:00Z')).toThrow(RangeError);
    expect(() => fakeClock('2026-02-29T09:00:00Z')).toThrow(RangeError); // 2026 is not a leap year
    expect(() => fakeClock('2026-04-31T09:00:00Z')).toThrow(RangeError);
    expect(() => fakeClock('2026-03-10T09:00:00Z').set('2026-06-31T09:00:00Z')).toThrow(RangeError);

    // Real days stay accepted, also when the offset moves the moment into another UTC day.
    expect(fakeClock('2028-02-29T09:00:00Z').now().toISOString()).toBe('2028-02-29T09:00:00.000Z');
    expect(fakeClock('2026-03-01T00:30:00+01:00').now().toISOString()).toBe(
      '2026-02-28T23:30:00.000Z',
    );
  });
});

describe('systemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
