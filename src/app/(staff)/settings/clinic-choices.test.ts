import { describe, expect, it } from 'vitest';
import messages from '@/i18n/en.json';
import { CLINIC_LOCALES } from '@/modules/tenancy';
import { countryChoices, currencyChoices, languageChoices, zoneChoices } from './clinic-choices';

// E01-T08a: what the Settings form's selects offer, as the page makes them on the server: the
// values the checks take, named for the reader, and a stored value the list lacks offered first, as
// it is, so a save never changes a field nobody touched. Names from this machine's Intl (Node's ICU).

describe('countryChoices: the phone countries, by their names', () => {
  it('names each code in the locale, A to Z by name', () => {
    expect(countryChoices(['MK', 'GB', 'AL', 'XK'], 'MK', 'en')).toEqual([
      { value: 'AL', label: 'Albania' },
      { value: 'XK', label: 'Kosovo' },
      { value: 'MK', label: 'North Macedonia' },
      { value: 'GB', label: 'United Kingdom' },
    ]);
  });

  it('a stored country the list lacks: offered first, as it is', () => {
    expect(countryChoices(['MK', 'GB'], 'XX', 'en')).toEqual([
      { value: 'XX', label: 'XX' },
      { value: 'MK', label: 'North Macedonia' },
      { value: 'GB', label: 'United Kingdom' },
    ]);
  });
});

describe('currencyChoices: the currencies, by their names, each with its code', () => {
  const label = (name: string, code: string) => `${name} (${code})`;

  it('A to Z by name, each as the message file writes it', () => {
    expect(currencyChoices(['MKD', 'EUR', 'GBP'], 'MKD', 'en', label)).toEqual([
      { value: 'GBP', label: 'British Pound (GBP)' },
      { value: 'EUR', label: 'Euro (EUR)' },
      { value: 'MKD', label: 'Macedonian Denar (MKD)' },
    ]);
    expect(messages.settings.clinic.currencyChoice).toBe('{name} ({code})');
  });

  it('a stored currency the list lacks, which the check takes: offered first, as it is', () => {
    expect(currencyChoices(['MKD'], 'XYZ', 'en', label)).toEqual([
      { value: 'XYZ', label: 'XYZ' },
      { value: 'MKD', label: 'Macedonian Denar (MKD)' },
    ]);
  });
});

describe('languageChoices: the languages a clinic may have', () => {
  it("every one a clinic may have is named in the message file's languages", () => {
    for (const code of CLINIC_LOCALES) expect(messages.languages[code], code).toBeTruthy();
  });

  it('in their order, each by its name; a stored one the list lacks first, as it is', () => {
    const name = (code: (typeof CLINIC_LOCALES)[number]) => messages.languages[code];
    expect(languageChoices(CLINIC_LOCALES, 'en', name)).toEqual([
      { value: 'en', label: 'English' },
    ]);
    expect(languageChoices(CLINIC_LOCALES, 'mk', name)).toEqual([
      { value: 'mk', label: 'mk' },
      { value: 'en', label: 'English' },
    ]);
  });
});

describe('zoneChoices: the zones by their areas', () => {
  const zones = [
    'America/Argentina/Buenos_Aires',
    'America/New_York',
    'Europe/Kyiv',
    'Europe/Skopje',
    'Pacific/Auckland',
    'UTC',
  ];

  it('UTC before the areas, each area with its zones in the order given', () => {
    expect(zoneChoices(zones, 'Europe/Skopje')).toEqual({
      ungrouped: ['UTC'],
      areas: [
        { area: 'America', zones: ['America/Argentina/Buenos_Aires', 'America/New_York'] },
        { area: 'Europe', zones: ['Europe/Kyiv', 'Europe/Skopje'] },
        { area: 'Pacific', zones: ['Pacific/Auckland'] },
      ],
    });
  });

  it('a stored zone the list lacks (another spelling, or one the database does not know): first, as it is', () => {
    expect(zoneChoices(zones, 'europe/skopje').ungrouped).toEqual(['europe/skopje', 'UTC']);
    expect(zoneChoices(zones, 'Europe/Kiev').ungrouped).toEqual(['Europe/Kiev', 'UTC']);
    expect(zoneChoices(zones, 'UTC').ungrouped).toEqual(['UTC']);
  });
});
