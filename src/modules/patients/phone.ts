import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from 'libphonenumber-js';

/**
 * A stored number (E.164) as the clinic's people write it (D-097): the national form when its
 * calling code is that of the clinic's own country (070 001 234 in North Macedonia), the
 * international one otherwise (+389 70 001 234 anywhere else). The calling code decides, not the
 * country the package reads from the number: it reads some British mobile numbers as Guernsey's,
 * and others as no country, which a clinic in Britain still writes nationally. A number the package
 * cannot read is shown as stored. Only the server formats: the metadata never reaches the browser.
 */
export function phoneAsWritten(e164: string, country: string): string {
  const number = parsePhoneNumberFromString(e164);
  if (!number) return e164;
  const own =
    isSupportedCountry(country) && number.countryCallingCode === getCountryCallingCode(country);
  return own ? number.formatNational() : number.formatInternational();
}
