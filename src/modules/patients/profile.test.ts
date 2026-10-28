import { describe, expect, it } from 'vitest';
import { ageOn } from './list';

// E01-T03a, acceptance 5: the profile's age, on the clinic's today. Pure; the dates are invented.

describe('ageOn, for the profile', () => {
  it.each([
    { what: 'the birthday is today', born: '1988-03-14', day: '2026-03-14', age: 38 },
    { what: 'the birthday is tomorrow', born: '1988-03-15', day: '2026-03-14', age: 37 },
    { what: 'the birthday was yesterday', born: '1988-03-13', day: '2026-03-14', age: 38 },
    {
      what: 'born on 29 February, on 28 February of a year without one',
      born: '2004-02-29',
      day: '2025-02-28',
      age: 20,
    },
    {
      what: 'born on 29 February, on 1 March of a year without one',
      born: '2004-02-29',
      day: '2025-03-01',
      age: 21,
    },
    {
      what: 'born on 29 February, on the 29th of a leap year',
      born: '2004-02-29',
      day: '2028-02-29',
      age: 24,
    },
    { what: 'born today', born: '2026-03-14', day: '2026-03-14', age: 0 },
    { what: 'a baby of a month', born: '2026-02-14', day: '2026-03-14', age: 0 },
  ])('$what: $age', ({ born, day, age }) => {
    expect(ageOn(born, day)).toBe(age);
  });

  it('a date of birth in the future has no age', () => {
    expect(ageOn('2026-03-15', '2026-03-14')).toBeNull();
    expect(ageOn('2027-01-01', '2026-03-14')).toBeNull();
  });
});
