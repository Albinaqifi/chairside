/*
 * The Treatment types tab's fields (E01-T09a), with no React and no database: the length's choices,
 * and the price, typed as text in the clinic's currency and stored in its minor units
 * (data-model.md, "Money"). The actions' schema and the tab use them; the rules are unit-tested.
 * No field here is a number field (D-118): the length is the browser's own select, the price a text.
 *
 * The tab runs in the browser, so this file imports no value of the scheduling module, whose code
 * is the server's: only its types.
 */

/**
 * The highest price, in minor units: the scheduling module's TREATMENT_PRICE_MAX, the largest
 * PostgreSQL `integer` (the price's column); the unit test holds the two equal.
 */
export const PRICE_MINOR_MAX = 2_147_483_647;

/** The lengths the select offers, in minutes: 5 to 240 in steps of 5. */
export const TYPE_LENGTHS: readonly number[] = Array.from({ length: 48 }, (_, i) => (i + 1) * 5);

/**
 * The longest length the actions take, in minutes: a day, as the booking drawer's (LENGTH_MAX,
 * calendar/booking-choices.ts). Above the select's 240, so a type's own length outside the steps
 * (one written before Settings had this tab) is kept when it is saved again.
 */
export const TYPE_LENGTH_MAX = 24 * 60;

/** The select's lengths: TYPE_LENGTHS, with the type's own joined to them in order when it is not one. */
export function typeLengthChoices(own: number | null): number[] {
  const lengths = new Set(TYPE_LENGTHS);
  if (own !== null) lengths.add(own);
  return [...lengths].sort((a, b) => a - b);
}

/** The length a new type's select begins with: half an hour, the demo's commonest. */
export const FIRST_TYPE_LENGTH = 30;

/** The longest price text the field takes, in characters, before its form is read. */
export const PRICE_TEXT_MAX = 20;

/**
 * A price as typed: up to nine digits, then optionally `.` or `,` and one or two digits ("1500",
 * "12.50", "12,5"). No sign, no grouping, no currency: the field's label names the currency.
 */
const PRICE_FORM = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

/** A price whose form is right: its whole part and its decimals, as typed ('' for none). */
export interface PriceText {
  whole: string;
  decimals: string;
}

/** The price's parts when its form is right (trimmed first), else null. */
export function readPriceText(text: string): PriceText | null {
  const match = PRICE_FORM.exec(text.trim());
  if (!match) return null;
  return { whole: match[1] ?? '', decimals: match[2] ?? '' };
}

/**
 * How many decimals the currency has: 2 for MKD and EUR, 0 for JPY, 3 for KWD, as Intl gives them
 * (the digits its prices are written with). A code Intl does not know is an Error: a clinic's
 * currency is one it knows (tenancy.clinicCurrencies()).
 */
export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits as number;
}

/** Why a price whose form is right cannot be stored in the clinic's currency. */
export type PriceRefusal = 'price_decimals' | 'price_too_high';

/**
 * The price in the currency's minor units: "12.50" with 2 digits is 1250, "1500" is 150000, "12.5" is
 * 1250; with 3 digits "12.5" is 12500. More decimals than the currency has ("12.5" in JPY, "12.00"
 * too) is `price_decimals`; more than its column holds, `price_too_high`.
 */
export function minorUnits(
  price: PriceText,
  digits: number,
): { ok: true; minor: number } | { ok: false; code: PriceRefusal } {
  if (price.decimals.length > digits) return { ok: false, code: 'price_decimals' };
  // At most nine digits and three decimals: twelve digits, well inside a double's exact integers.
  const minor = Number(price.whole + price.decimals.padEnd(digits, '0'));
  if (minor > PRICE_MINOR_MAX) return { ok: false, code: 'price_too_high' };
  return { ok: true, minor };
}

/**
 * A stored price as the edit field shows it, for the same currency, so that a save of the form as
 * it opened stores it again: 1250 with 2 digits is "12.50", 150000 is "1500" (no decimals when they
 * are all 0), 1500 with 0 digits is "1500"; with 3 digits 12500 is "12.50", the field's two decimals
 * (a third decimal's 0 dropped). One whose third decimal is not 0 (12345) shows "12.345", which no
 * form stores: it can only have been written another way, and the field then says to check it.
 */
export function priceText(minor: number, digits: number): string {
  if (digits === 0) return String(minor);
  const scale = 10 ** digits;
  const whole = Math.floor(minor / scale);
  const parts = minor % scale;
  if (parts === 0) return String(whole);
  let decimals = String(parts).padStart(digits, '0');
  while (decimals.length > 2 && decimals.endsWith('0')) decimals = decimals.slice(0, -1);
  return `${whole}.${decimals}`;
}

/** A stored price as an amount of the currency, for the formatter: 1250 with 2 digits is 12.5. */
export function priceAmount(minor: number, digits: number): number {
  return minor / 10 ** digits;
}
