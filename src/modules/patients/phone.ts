import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
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

/**
 * The invisible marks a copied number carries (Unicode's format characters): WhatsApp, Teams and
 * Outlook wrap a number in direction marks, which the package reads as letters, and trim() keeps.
 */
const INVISIBLE = /\p{Cf}/gu;
/** A letter anywhere: no number of any country is written with one (`ext. 5` holds some too). */
const LETTER = /\p{L}/u;
/** E.164, as the column's check has it: at most 15 digits after the +. */
const E164 = /^\+[1-9][0-9]{1,14}$/;

/**
 * A phone typed at the desk, read with the clinic's own country (D-097, E01-T02b): its E.164 form,
 * or null when the number is impossible. In the national form it takes that country (070 001 234
 * in North Macedonia); with `+` or the country's own international prefix (00 there) it names its
 * own. The invisible marks of a copied number are removed and the text trimmed before it is read.
 *
 * Impossible: a length no number of its country has, letters, text around the number, a calling
 * code no country has, an extension (no message reaches one), more than 15 digits (the package
 * lets some through, the column's check would not), and a number read with its trunk 0 still in it:
 * its national number starts with 0 and is not valid (070 001 23, a digit missing, which the
 * package keeps as +38907000123 and calls possible). A valid number whose own digits start with 0
 * (a line in Rome) is kept, and so is a possible number the package does not know: a new range is
 * never refused at the desk, so validity alone never refuses.
 *
 * A clinic country the package does not support is the clinic's mistake, not the desk's: an Error,
 * which the action answers `internal`. Non-throwing calls of the package only.
 */
export function readPhone(typed: string, country: string): string | null {
  if (!isSupportedCountry(country)) {
    throw new Error('readPhone: the clinic names a country the phone package does not know');
  }
  const text = typed.replace(INVISIBLE, '').trim();
  if (text === '' || LETTER.test(text)) return null;
  if (validatePhoneNumberLength(text, country) !== undefined) return null;
  // extract: false reads the whole text as one number, never one picked out of other text.
  const number = parsePhoneNumberFromString(text, { defaultCountry: country, extract: false });
  if (!number || number.ext !== undefined || !E164.test(number.number)) return null;
  if (number.nationalNumber.startsWith('0') && !number.isValid()) return null;
  return number.number;
}
