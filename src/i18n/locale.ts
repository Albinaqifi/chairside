/**
 * The app's one locale (D-053: English only), with the 24-hour clock (D-049; owner, 2026-10-12,
 * E01-T04b): every time of day reads "09:00" and "14:30", in every format next-intl makes, on the
 * server and in the browser, while dates stay English ("Monday, October 12"). The Unicode extension
 * `-u-hc-h23` gives the hour cycle to every Intl format made with this locale, so no call names it;
 * `en-GB` would change the dates too ("Monday 12 October").
 *
 * src/i18n/request.ts gives it to next-intl for every request, and the root layout's provider hands it
 * to the client components. A test that renders a time renders with it.
 */
export const LOCALE = 'en-u-hc-h23';

/** The page's language for `<html lang>`: the locale without its extension, `en`. */
export function languageOf(locale: string): string {
  return new Intl.Locale(locale).language;
}
