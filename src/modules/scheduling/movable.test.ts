import { describe, expect, it } from 'vitest';
import { APPOINTMENT_STATUSES } from './appointments';
import { movable, MOVABLE_STATUSES } from './movable';

// E01-T06c: which statuses move. One function says so, for the move and for the calendar's read.
describe('movable', () => {
  it('is true for a booked and a confirmed visit only', () => {
    const moving = APPOINTMENT_STATUSES.filter((status) => movable(status));
    expect(moving).toEqual(['booked', 'confirmed']);
    expect(MOVABLE_STATUSES).toEqual(moving);
  });

  it.each(['arrived', 'completed', 'cancelled', 'no_show', '', 'Booked', 'unknown'])(
    'is false for %j',
    (status) => {
      expect(movable(status)).toBe(false);
    },
  );
});
