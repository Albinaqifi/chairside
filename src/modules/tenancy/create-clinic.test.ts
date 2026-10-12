import { describe, expect, it } from 'vitest';
import {
  clinicCountries,
  clinicCurrencies,
  newClinicProblems,
  type NewClinic,
} from './create-clinic';

// E00-T05b: what a new clinic may not be stored with, as `pnpm clinic:create` checks it before
// anything connects and createClinic() again before it writes.

const NORTH_MACEDONIA: NewClinic = {
  name: 'Lakeside Dental',
  timeZone: 'Europe/Skopje',
  country: 'MK',
  currency: 'MKD',
  locale: 'en',
};

describe('newClinicProblems', () => {
  it("finds none in North Macedonia's settings, or in another country's", () => {
    expect(newClinicProblems(NORTH_MACEDONIA)).toEqual([]);
    expect(
      newClinicProblems({
        name: 'Забна клиника',
        timeZone: 'Europe/London',
        country: 'GB',
        currency: 'GBP',
        locale: 'en',
      }),
    ).toEqual([]);
  });

  it.each([
    { field: 'name', value: '' },
    { field: 'name', value: '  ' },
    { field: 'timeZone', value: 'Europe/Skopie' },
    { field: 'timeZone', value: '' },
    { field: 'country', value: 'UK' },
    { field: 'country', value: 'mk' },
    { field: 'country', value: 'XX' },
    { field: 'currency', value: 'mkd' },
    { field: 'currency', value: 'MK' },
    { field: 'currency', value: 'MKDD' },
    { field: 'locale', value: 'mk' },
    { field: 'locale', value: 'EN' },
  ])('finds $field when it is "$value"', ({ field, value }) => {
    expect(newClinicProblems({ ...NORTH_MACEDONIA, [field]: value })).toEqual([field]);
  });

  it('finds every field at once, in the order of a new clinic', () => {
    expect(
      newClinicProblems({
        name: '',
        timeZone: 'Mars/Olympus',
        country: 'UK',
        currency: 'denar',
        locale: 'fr',
      }),
    ).toEqual(['name', 'timeZone', 'country', 'currency', 'locale']);
  });
});

// E01-T08a, acceptance 2 (D-110): the zone by its name, never an offset, before anything connects.
// Whether the database knows the name is checked in the transaction that stores it (knownTimeZone()).
describe('newClinicProblems: the time zone (E01-T08a)', () => {
  it.each(['+01:00', '-05:00', 'Etc/GMT-1', 'GMT'])('finds timeZone when it is "%s"', (zone) => {
    expect(newClinicProblems({ ...NORTH_MACEDONIA, timeZone: zone })).toEqual(['timeZone']);
  });

  it.each(['europe/skopje', 'UTC', 'Europe/Kyiv', 'Europe/Kiev'])(
    'finds none in "%s": the database decides whether it knows it',
    (zone) => {
      expect(newClinicProblems({ ...NORTH_MACEDONIA, timeZone: zone })).toEqual([]);
    },
  );
});

describe('the values the checks take, as Settings offers them (E01-T08a)', () => {
  it("every country is one the phone package supports, North Macedonia's among them", () => {
    const countries = clinicCountries();
    expect(countries).toContain('MK');
    expect(countries.length).toBeGreaterThan(200);
    for (const country of countries) {
      expect(newClinicProblems({ ...NORTH_MACEDONIA, country }), country).toEqual([]);
    }
  });

  it('every currency is three capital letters, the denar, the euro and the pound among them', () => {
    const currencies = clinicCurrencies();
    expect(currencies).toEqual(expect.arrayContaining(['MKD', 'EUR', 'GBP']));
    for (const currency of currencies) {
      expect(newClinicProblems({ ...NORTH_MACEDONIA, currency }), currency).toEqual([]);
    }
  });
});
