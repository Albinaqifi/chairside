import { describe, expect, it } from 'vitest';
import { newClinicProblems, type NewClinic } from './create-clinic';

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
