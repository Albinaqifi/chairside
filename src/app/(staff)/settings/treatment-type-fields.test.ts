import { describe, expect, it } from 'vitest';
import { TREATMENT_PRICE_MAX } from '@/modules/scheduling';
import {
  currencyDigits,
  minorUnits,
  PRICE_MINOR_MAX,
  priceAmount,
  priceText,
  readPriceText,
  TYPE_LENGTHS,
  typeLengthChoices,
} from './treatment-type-fields';

// E01-T09a, acceptance 4 (the rules' side): the Treatment types tab's length choices, and a price
// typed in the clinic's currency read into its minor units. No React and no database. The actions'
// schema and handlers are in tests/integration/treatment-types.test.ts.

/** A price typed, in minor units with the currency's digits; or the refusal, or null (its form). */
function stored(text: string, digits: number) {
  const price = readPriceText(text);
  if (price === null) return null;
  const minor = minorUnits(price, digits);
  return minor.ok ? minor.minor : minor.code;
}

describe('the length select (E01-T09a)', () => {
  it('offers 5 to 240 minutes in steps of 5', () => {
    expect(TYPE_LENGTHS[0]).toBe(5);
    expect(TYPE_LENGTHS.at(-1)).toBe(240);
    expect(TYPE_LENGTHS).toHaveLength(48);
    expect(TYPE_LENGTHS.every((minutes) => minutes % 5 === 0)).toBe(true);
  });

  it("keeps a type's own length outside the steps as a choice, in order", () => {
    expect(typeLengthChoices(null)).toEqual(TYPE_LENGTHS);
    expect(typeLengthChoices(45)).toEqual(TYPE_LENGTHS);
    const withSeven = typeLengthChoices(7);
    expect(withSeven.slice(0, 3)).toEqual([5, 7, 10]);
    expect(typeLengthChoices(300).at(-1)).toBe(300);
  });
});

describe('a price in the clinic currency (E01-T09a, acceptance 4)', () => {
  it("knows each currency's decimals as Intl does", () => {
    expect(currencyDigits('MKD')).toBe(2);
    expect(currencyDigits('EUR')).toBe(2);
    expect(currencyDigits('JPY')).toBe(0);
    expect(currencyDigits('KWD')).toBe(3);
  });

  it('in a two-digit currency: "12.50" is 1250, "1500" is 150000, "12.5" is 1250, "12,50" too', () => {
    expect(stored('12.50', 2)).toBe(1250);
    expect(stored('1500', 2)).toBe(150000);
    expect(stored('12.5', 2)).toBe(1250);
    expect(stored('12,50', 2)).toBe(1250);
    expect(stored(' 0 ', 2)).toBe(0);
  });

  it('in a currency without decimals: "1500" is 1500; any decimals are price_decimals, "12.00" too', () => {
    expect(stored('1500', 0)).toBe(1500);
    expect(stored('12.5', 0)).toBe('price_decimals');
    expect(stored('12.00', 0)).toBe('price_decimals');
  });

  it('in a three-digit currency: "12.5" is 12500', () => {
    expect(stored('12.5', 3)).toBe(12500);
  });

  it('"12.345", "-5", "abc", "1 500", "1.", ".5" and ten digits are no price: refused at the field', () => {
    for (const text of ['12.345', '-5', 'abc', '1 500', '1.', '.5', '1234567890', '12.5€']) {
      expect(readPriceText(text), text).toBeNull();
    }
  });

  it('above what the column holds: price_too_high; at it, kept', () => {
    expect(stored('999999999.99', 2)).toBe('price_too_high');
    expect(stored('21474836.47', 2)).toBe(2147483647);
    expect(stored('21474836.48', 2)).toBe('price_too_high');
    expect(PRICE_MINOR_MAX).toBe(TREATMENT_PRICE_MAX);
  });

  it('a stored price as the edit field shows it, read back to the same minor units', () => {
    expect(priceText(1250, 2)).toBe('12.50');
    expect(priceText(150000, 2)).toBe('1500');
    expect(priceText(5, 2)).toBe('0.05');
    expect(priceText(1500, 0)).toBe('1500');
    expect(priceText(12500, 3)).toBe('12.50');
    expect(priceText(12050, 3)).toBe('12.05');
    expect(priceText(12345, 3)).toBe('12.345');
    // Every price a form stores, opened in the edit and saved as it is, stores the same again.
    for (const [minor, digits] of [
      [1250, 2],
      [150000, 2],
      [5, 2],
      [1500, 0],
      [12500, 3],
      [12050, 3],
      [7, 0],
    ] as const) {
      expect(stored(priceText(minor, digits), digits), `${minor}, ${digits}`).toBe(minor);
    }
    expect(priceAmount(1250, 2)).toBe(12.5);
    expect(priceAmount(1500, 0)).toBe(1500);
  });
});
