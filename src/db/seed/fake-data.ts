/**
 * The fake-data rules (security-privacy.md section 9, D-044, D-049), in one place for this seed and
 * every later one: every name a seed writes comes from the invented lists below, every phone from
 * one made-up block of +389 numbers, every email is at example.test. fake-data.test.ts reads every
 * row of every seed file against them (fakeDataProblems), so a later seed is checked without a new
 * test; a later seed that needs other names adds invented ones to these lists.
 */

/** Invented first names, in Latin and in Cyrillic letters (D-049), for later seeds' patients. */
export const FIRST_NAMES = {
  latin: ['Ana', 'Bojan', 'Elena', 'Marko', 'Arben', 'Blerina', 'Shpëtim', 'Mimoza'],
  cyrillic: ['Ана', 'Бојан', 'Елена', 'Марко', 'Јована', 'Ѓорѓи', 'Љубица', 'Стефан'],
} as const;

/** Invented last names, in Latin and in Cyrillic letters (D-049). */
export const LAST_NAMES = {
  latin: ['Ezerovski', 'Planinska', 'Kamenov', 'Brezovska', 'Kodra', 'Lumi', 'Dardha', 'Shkëmbi'],
  cyrillic: [
    'Езеровски',
    'Планинска',
    'Каменов',
    'Брезовска',
    'Ѕвездовски',
    'Ќошкова',
    'Њивовски',
    'Лозанова',
  ],
} as const;

/** Staff are named with a role word, so no screenshot shows a person's name (E00-T04b). */
export const STAFF_NAMES = ['Owner', 'Dentist', 'Hygienist', 'Front desk'] as const;

/** Invented clinic names: one in Latin letters (demo line 30), one in Cyrillic. */
export const CLINIC_NAMES = ['Harbour Street Dental', 'Забна клиника Сончоглед'] as const;

/**
 * Providers' short names, as a calendar column's head shows them (E01-T01b, the demo's "Dr. Okafor"
 * at line 1370): a title or an initial before a last name of the lists. A provider's full `name` is
 * a first and a last name of the lists.
 */
export const PROVIDER_SHORT_NAMES = [
  'Dr. Planinska',
  'Dr. Kodra',
  'M. Lumi',
  'Д-р Ќошкова',
] as const;

/** Treatment names: the demo's catalogue (line 1518). Words, not anyone's name. */
export const TREATMENT_NAMES = [
  'Checkup',
  'Cleaning',
  'Filling',
  'Crown prep',
  'Crown fit',
  'Root canal',
  'Extraction',
  'Consultation',
  'Emergency',
  'Whitening',
] as const;

/**
 * The made-up phone numbers every seed takes its phones from: the prefix and four more digits, in
 * E.164 form (+389 70 00x xxx). No test range is reserved for +389, so a number here may be
 * someone's: outside production, messages go only to an allow-list of test contacts (D-044), which
 * is what keeps anything from being sent to them.
 */
export const PHONE_BLOCK = { prefix: '+3897000', digits: 4 } as const;

/** The domain of every email a seed writes (RFC 2606: it never reaches anyone). */
export const EMAIL_DOMAIN = 'example.test';

/** The n-th number of the phone block, n from 0 to 9999. */
export function fakePhone(n: number): string {
  const size = 10 ** PHONE_BLOCK.digits;
  if (!Number.isInteger(n) || n < 0 || n >= size) {
    throw new RangeError(`fakePhone: n must be an integer from 0 to ${size - 1}`);
  }
  return `${PHONE_BLOCK.prefix}${String(n).padStart(PHONE_BLOCK.digits, '0')}`;
}

const PHONE_PATTERN = new RegExp(
  `^${PHONE_BLOCK.prefix.replace('+', '\\+')}[0-9]{${PHONE_BLOCK.digits}}$`,
);

/** True for a number of the phone block, written as fakePhone() writes it. */
export function isFakePhone(value: string): boolean {
  return PHONE_PATTERN.test(value);
}

/** True for an address at example.test: one `@`, something before it, nothing else after it. */
export function isFakeEmail(value: string): boolean {
  const [local, domain, ...rest] = value.split('@');
  return rest.length === 0 && Boolean(local) && !/\s/.test(local ?? '') && domain === EMAIL_DOMAIN;
}

const firstNames: readonly string[] = [...FIRST_NAMES.latin, ...FIRST_NAMES.cyrillic];
const lastNames: readonly string[] = [...LAST_NAMES.latin, ...LAST_NAMES.cyrillic];
const wholeNames: readonly string[] = [
  ...STAFF_NAMES,
  ...CLINIC_NAMES,
  ...PROVIDER_SHORT_NAMES,
  ...TREATMENT_NAMES,
  ...firstNames,
  ...lastNames,
];

/**
 * True for a name from the lists: a staff, clinic or treatment name, a provider's short name, a
 * first or a last name, or a first name and a last name in the same letters ("Ana Kodra",
 * "Ана Каменов").
 */
export function isFakeName(value: string): boolean {
  if (wholeNames.includes(value)) return true;
  const [first, last, ...rest] = value.split(' ');
  if (rest.length > 0 || first === undefined || last === undefined) return false;
  return (['latin', 'cyrillic'] as const).some(
    (letters) =>
      (FIRST_NAMES[letters] as readonly string[]).includes(first) &&
      (LAST_NAMES[letters] as readonly string[]).includes(last),
  );
}

/** Keys that hold a name, an email or a phone: first_name, clinicName, email, mobile_phone… */
const NAME_KEY = /name/i;
const EMAIL_KEY = /e-?mail/i;
const PHONE_KEY = /phone|mobile/i;
/** A value written like a phone number in E.164 form, whatever its key. */
const PHONE_LIKE = /^\+[0-9][0-9 ]{5,}$/;

/**
 * Where a seed file breaks the rules: the path of every string, at any depth, that is a name, an
 * email or a phone and is not from the lists, the domain or the block. A name, email or phone is
 * found by its key, and an email or phone also by its form (an `@`, a `+` and digits), so a column
 * with another key is checked too. Paths only, never the values: no personal data in a test's
 * output, synthetic data included (agent rule 6).
 */
export function fakeDataProblems(value: unknown, path = '', key = ''): string[] {
  if (typeof value === 'string') {
    const problems: string[] = [];
    if ((EMAIL_KEY.test(key) || value.includes('@')) && !isFakeEmail(value)) {
      problems.push(`${path}: an email that is not at ${EMAIL_DOMAIN}`);
    }
    if ((PHONE_KEY.test(key) || PHONE_LIKE.test(value)) && !isFakePhone(value)) {
      problems.push(`${path}: a phone outside the block ${PHONE_BLOCK.prefix}…`);
    }
    if (NAME_KEY.test(key) && !isFakeName(value)) {
      problems.push(`${path}: a name that is not in the invented lists`);
    }
    return problems;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) =>
      fakeDataProblems(item, `${path}[${index}]`, key),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([field, item]) =>
      fakeDataProblems(item, path ? `${path}.${field}` : field, field),
    );
  }
  return [];
}
