import { describe, expect, it } from 'vitest';
import { phoneWithCountryCode, readPhone } from './phone';

// E01-T02b, acceptance 1 and 2: a phone typed at the desk, read with the clinic's own country. The
// numbers stored come from the seed's made-up block (+389 70 00x xxx, src/db/seed/fake-data.ts);
// the two that are not (a range the package does not know, a line in Rome) are read here only and
// never stored (agent rule 5). The impossible ones are no one's number.

describe("readPhone: the same number however the desk writes it, in the clinic's country", () => {
  it.each([
    { typed: '070 001 234', how: 'the national form' },
    { typed: '+389 70 001 234', how: 'with +389' },
    { typed: '00389 70 001 234', how: 'with 00389, the country’s own international prefix' },
    { typed: '+389 (0)70 001 234', how: 'with the trunk 0 in brackets' },
    { typed: '070-001-234', how: 'with dashes' },
    { typed: '(070) 001 234', how: 'with brackets' },
    { typed: '+38970001234', how: 'in E.164' },
    { typed: '  070 001 234  ', how: 'with spaces around it' },
    { typed: '‪070 001 234‬', how: 'copied, wrapped in direction marks' },
    { typed: '‎+389 70 001 234', how: 'copied, after a left-to-right mark' },
    { typed: '070​001⁠234', how: 'with invisible marks inside it' },
  ])('$how: +38970001234', ({ typed }) => {
    expect(readPhone(typed, 'MK')).toBe('+38970001234');
  });

  it('keeps a possible number the package does not know: a new range is never refused', () => {
    expect(readPhone('+389 99 123 456', 'MK')).toBe('+38999123456');
  });

  it('keeps a valid number whose own digits start with 0, a line in Rome', () => {
    expect(readPhone('+39 06 1234 5678', 'MK')).toBe('+390612345678');
  });

  it("reads the national form with the clinic's country, not North Macedonia's", () => {
    expect(readPhone('+389 70 001 234', 'GB')).toBe('+38970001234');
    expect(readPhone('070 001 234', 'GB')).not.toBe('+38970001234');
  });
});

describe('readPhone: an impossible phone is none (null)', () => {
  it.each([
    { typed: '070 001 2345', why: 'too long' },
    { typed: '070 00', why: 'too short' },
    { typed: '07', why: 'far too short' },
    { typed: '070 abc 234', why: 'letters' },
    { typed: '070 OO1 234', why: 'the letter O for a zero' },
    { typed: '070 001 234 ext. 5', why: 'an extension, written with letters' },
    { typed: '070 001 234 #5', why: 'an extension, written without letters' },
    { typed: '+49 30 1234567890123', why: 'more than 15 digits, which the package lets through' },
    { typed: '070 001 23', why: 'a digit missing, read with its trunk 0 still in it' },
    { typed: '+999 123 456', why: 'a calling code no country has' },
    { typed: 'Phone: 070 001 234', why: 'text around the number' },
    { typed: '070 001 234, 070 001 235', why: 'two numbers' },
    { typed: '+', why: 'a plus alone' },
    { typed: '', why: 'nothing' },
    { typed: '   ', why: 'blanks' },
  ])('$why', ({ typed }) => {
    expect(readPhone(typed, 'MK')).toBeNull();
  });
});

describe("readPhone: a clinic country the package does not support is the clinic's mistake", () => {
  it('throws an Error, which the action answers internal, never phone_impossible', () => {
    expect(() => readPhone('070 001 234', 'XX')).toThrow(Error);
    expect(() => readPhone('070 001 234', 'XX')).toThrow(/country the phone package does not know/);
  });

  it('whatever was typed: the country is checked first', () => {
    expect(() => readPhone('', 'XX')).toThrow(Error);
  });
});

// E01-T08b, acceptance 5: the clinic's own phone on Settings, with its country code (D-111).
describe('phoneWithCountryCode: a stored number with its country code, whatever the country', () => {
  it('the international form, which reads the same with every phone country', () => {
    expect(phoneWithCountryCode('+38970001402')).toBe('+389 70 001 402');
    expect(phoneWithCountryCode('+442079460001')).toBe('+44 20 7946 0001');
    for (const country of ['MK', 'GB', 'RS', 'AL']) {
      expect(readPhone(phoneWithCountryCode('+38970001402'), country), country).toBe(
        '+38970001402',
      );
    }
  });

  it('a possible number the package does not know keeps its code; one it cannot read, as stored', () => {
    expect(phoneWithCountryCode('+38999123456')).toMatch(/^\+389 /);
    expect(readPhone(phoneWithCountryCode('+38999123456'), 'GB')).toBe('+38999123456');
    expect(phoneWithCountryCode('+3')).toBe('+3');
  });
});
