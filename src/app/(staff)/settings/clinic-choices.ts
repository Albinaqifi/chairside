/*
 * What the selects of the Settings form offer (E01-T08a): the values their checks take
 * (tenancy.newClinicProblems() and the database's zones), named for the person who reads them. Made
 * on the server while the page renders, so the phone package's country list stays there (D-097) and
 * the names are the server's: a browser with other names would not match the page it hydrates.
 * Country and currency names come from Intl.DisplayNames (data, as a formatted date is), the
 * languages' from the message file.
 *
 * A stored value the choices lack is offered first, as it is: a select always shows what the clinic
 * has, so a save never changes a field nobody touched. What the check then says of it is the
 * check's.
 */

/** One option of a select: what the form sends, and what the person reads. */
export interface Choice {
  value: string;
  label: string;
}

/** The zones a clinic may have, as the select shows them. */
export interface ZoneChoices {
  /** Before the areas: UTC, and the stored zone when the list lacks it. */
  ungrouped: string[];
  /** The regions' zones, by the area their names start with (`Europe`), in the order given. */
  areas: { area: string; zones: string[] }[];
}

/** The choices, with the stored value before them when they lack it. */
function withStored(choices: Choice[], stored: string): Choice[] {
  return choices.some((choice) => choice.value === stored)
    ? choices
    : [{ value: stored, label: stored }, ...choices];
}

/** By their names, as the locale orders words. */
function byLabel(choices: Choice[], locale: string): Choice[] {
  const collator = new Intl.Collator(locale);
  return [...choices].sort((a, b) => collator.compare(a.label, b.label));
}

/** The countries a phone may be read with (D-097), by their names in the locale. */
export function countryChoices(codes: readonly string[], stored: string, locale: string): Choice[] {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' });
  const choices = codes.map((code) => ({ value: code, label: names.of(code) ?? code }));
  return withStored(byLabel(choices, locale), stored);
}

/**
 * The currencies, by their names in the locale, each shown as `label` writes it with its code
 * ("Macedonian Denar (MKD)": several currencies have names alike).
 */
export function currencyChoices(
  codes: readonly string[],
  stored: string,
  locale: string,
  label: (name: string, code: string) => string,
): Choice[] {
  const names = new Intl.DisplayNames([locale], { type: 'currency', fallback: 'code' });
  const byName = byLabel(
    codes.map((code) => ({ value: code, label: names.of(code) ?? code })),
    locale,
  );
  return withStored(
    byName.map((choice) => ({ value: choice.value, label: label(choice.label, choice.value) })),
    stored,
  );
}

/** The languages a clinic may have, in their order, each by its name from the message file. */
export function languageChoices<Code extends string>(
  codes: readonly Code[],
  stored: string,
  name: (code: Code) => string,
): Choice[] {
  return withStored(
    codes.map((code) => ({ value: code, label: name(code) })),
    stored,
  );
}

/**
 * The zones by their areas, each in the order given (the database's, by name, from
 * tenancy.clinicTimeZones()). Before them, the stored zone when the list lacks it, then the zones
 * whose names have no area: UTC.
 */
export function zoneChoices(zones: readonly string[], stored: string): ZoneChoices {
  const ungrouped = zones.includes(stored) ? [] : [stored];
  const byArea = new Map<string, string[]>();
  for (const zone of zones) {
    const slash = zone.indexOf('/');
    if (slash === -1) {
      ungrouped.push(zone);
      continue;
    }
    const area = zone.slice(0, slash);
    const listed = byArea.get(area);
    if (listed) listed.push(zone);
    else byArea.set(area, [zone]);
  }
  return { ungrouped, areas: [...byArea].map(([area, listed]) => ({ area, zones: listed })) };
}
