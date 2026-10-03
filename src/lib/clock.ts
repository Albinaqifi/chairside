/**
 * The source of "now". Business logic never reads the system clock: it receives the current
 * time as a value, or a Clock, from the edge (request handler, job, script). Tests pass a
 * fake clock and set the time freely.
 */
export interface Clock {
  now(): Date;
}

/** The real clock. Only edges create and pass it on. */
export const systemClock: Clock = {
  now: () => new Date(),
};

export interface FakeClock extends Clock {
  /** Moves the clock to a moment. */
  set(at: Date | string): void;
  /** Moves the clock by a number of milliseconds (negative moves it back). */
  advance(ms: number): void;
}

/**
 * A clock for tests. It stands still until moved. Strings must be ISO times with `Z` or an
 * offset, so a test never depends on the time zone of the machine running it, and must name a
 * day that exists: `2026-02-30` is refused, not read as 2 March.
 */
export function fakeClock(start: Date | string): FakeClock {
  let current = toTime(start);
  return {
    now: () => new Date(current),
    set: (at) => {
      current = toTime(at);
    },
    advance: (ms) => {
      if (!Number.isFinite(ms)) {
        throw new RangeError('fakeClock.advance: ms must be a finite number');
      }
      // A Date holds at most 100 million days either side of 1970; beyond that it is Invalid Date.
      if (Number.isNaN(new Date(current + ms).getTime())) {
        throw new RangeError('fakeClock.advance: the clock would leave the range of valid dates');
      }
      current += ms;
    },
  };
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function toTime(at: Date | string): number {
  if (typeof at === 'string') {
    if (!ISO_WITH_ZONE.test(at)) {
      throw new RangeError(
        'fakeClock: use an ISO time with Z or an offset, e.g. 2026-03-10T09:00:00Z',
      );
    }
    // JavaScript moves a day the month does not have into the next month. Read the written
    // date on its own: if it comes back as another date, that day does not exist.
    const day = at.slice(0, 10);
    const parsed = new Date(`${day}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      throw new RangeError(`fakeClock: ${day} is not a day of the calendar`);
    }
  }
  const time = new Date(at).getTime();
  if (Number.isNaN(time)) throw new RangeError('fakeClock: invalid date');
  return time;
}
