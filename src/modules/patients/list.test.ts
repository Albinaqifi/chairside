import { describe, expect, it } from 'vitest';
import { ageOn, dayInZone, searchTerms } from './list';
import { phoneAsWritten } from './phone';

// E01-T02a: the parts of the patient list that need no database. The search itself, against real
// rows, is in tests/integration/patients-list.test.ts. Every number is from the seed's made-up
// block (src/db/seed/fake-data.ts).

describe('searchTerms: what a search looks for', () => {
  it.each([
    { typed: '70001234', digits: '70001234' },
    { typed: '70 001 234', digits: '70001234' },
    { typed: '+389 70 001 234', digits: '38970001234' },
    { typed: '00389 70 001 234', digits: '38970001234' },
    { typed: '070 001 234', digits: '70001234' },
    { typed: '070/001-234', digits: '70001234' },
    { typed: '(070) 001.234', digits: '70001234' },
    { typed: '  070   001 ', digits: '70001' },
  ])('a phone written $typed: its digits $digits', ({ typed, digits }) => {
    expect(searchTerms(typed).digits).toBe(digits);
  });

  it('drops a leading 00 or 0 once only', () => {
    expect(searchTerms('000123').digits).toBe('0123');
    expect(searchTerms('0').digits).toBeNull();
    expect(searchTerms('00').digits).toBeNull();
  });

  it('text with a letter in it looks for names only', () => {
    expect(searchTerms('Ana 070').digits).toBeNull();
    expect(searchTerms('Ана').digits).toBeNull();
  });

  it('nothing but signs: no digits to look for', () => {
    expect(searchTerms('+').digits).toBeNull();
    expect(searchTerms('( )').digits).toBeNull();
  });

  it('trims the text, and reads each run of spaces as one', () => {
    expect(searchTerms('  Ana \t  Kodra  ').text).toBe('Ana Kodra');
    expect(searchTerms('   ').text).toBe('');
  });
});

describe('ageOn: whole years on a day', () => {
  it.each([
    { born: '1988-03-14', day: '2026-03-13', age: 37 },
    { born: '1988-03-14', day: '2026-03-14', age: 38 },
    { born: '1988-03-14', day: '2026-12-31', age: 38 },
    { born: '2026-10-07', day: '2026-10-07', age: 0 },
    // Born on 29 February: a year older on 1 March, and on the 29th in a leap year.
    { born: '2004-02-29', day: '2026-02-28', age: 21 },
    { born: '2004-02-29', day: '2026-03-01', age: 22 },
    { born: '2004-02-29', day: '2028-02-29', age: 24 },
  ])('born $born, on $day: $age', ({ born, day, age }) => {
    expect(ageOn(born, day)).toBe(age);
  });

  it('a birth after the day has no age', () => {
    expect(ageOn('2026-10-08', '2026-10-07')).toBeNull();
  });
});

describe("dayInZone: the clinic's today, whatever the computer's zone", () => {
  // 23:30 UTC on 7 October is already 8 October in Skopje (UTC+2 in summer time) and in Auckland.
  const lateEvening = new Date('2026-10-07T23:30:00Z');

  it.each([
    { zone: 'UTC', day: '2026-10-07' },
    { zone: 'Europe/Skopje', day: '2026-10-08' },
    { zone: 'Pacific/Auckland', day: '2026-10-08' },
    { zone: 'America/New_York', day: '2026-10-07' },
  ])('$zone: $day', ({ zone, day }) => {
    expect(dayInZone(lateEvening, zone)).toBe(day);
  });
});

describe('phoneAsWritten: a stored number as the clinic writes it', () => {
  it("the national form for a number of the clinic's own country", () => {
    expect(phoneAsWritten('+38970001234', 'MK')).toBe('070 001 234');
    expect(phoneAsWritten('+38970000101', 'MK')).toBe('070 000 101');
  });

  it('the international form for a number of another country', () => {
    expect(phoneAsWritten('+38970001234', 'GB')).toBe('+389 70 001 234');
    expect(phoneAsWritten('+38970001234', 'AL')).toBe('+389 70 001 234');
  });

  it('the international form when the clinic names a country the package does not know', () => {
    expect(phoneAsWritten('+38970001234', 'XX')).toBe('+389 70 001 234');
  });

  it('as stored when the package cannot read it', () => {
    expect(phoneAsWritten('+3', 'MK')).toBe('+3');
  });
});
