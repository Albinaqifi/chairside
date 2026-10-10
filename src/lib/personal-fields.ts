/**
 * Field names that hold personal data. The logger drops these fields before anything is
 * written. Names are compared after lower-casing and removing everything but letters and
 * digits, so `firstName`, `first_name` and `FIRST-NAME` are the same field. An ending also
 * matches in the plural: `patientNames` as `patientName` (below).
 *
 * Add a name when a new kind of personal data appears. Never remove one to make a log line
 * work: log an id instead.
 */

/** Fields matched by their whole name. */
export const PERSONAL_FIELDS = [
  'dob',
  'embg', // North Macedonian personal identification number
  'nationalId',
  'street',
  'city',
  'postalCode',
  'postcode',
  'zip',
  'ip',
  'to', // a message's recipient: a phone number or an email address
  'from',
  'reason', // free text, e.g. why a patient cancelled
  'text',
  'subject',
  'content',
  'comment',
  'cookie',
  'setCookie', // response header carrying the session token
  'authorization',
  'identifier', // the auth library's verification rows: an email address or a token
  // Postgres error details quote row values, e.g. "Key (email)=(...) already exists"
  'detail',
  // Postgres error context can quote the data, e.g. "JSON data, line 1: ..."
  'where',
] as const;

/** Endings that mark personal data, so compound names such as `patientEmail` match too. */
export const PERSONAL_FIELD_ENDINGS = [
  'name', // firstName, patient_name, pathname (URLs can carry link tokens) ...
  'email',
  'phone',
  'phoneNumber',
  'e164', // a phone number in E.164 form: the patient phone column, phone_e164
  'mobile',
  'msisdn',
  'waId', // WhatsApp id: the phone number
  'recipient',
  'contact',
  'address',
  'dateOfBirth',
  'birthDate',
  'birthday',
  'diagnosis',
  'note',
  'notes',
  'body', // message and request bodies
  'html',
  'smsText',
  'messageText',
  // An appointment's label, which names a treatment ("Filling 36"), and the treatment itself
  // (E01-T02b): title, appointmentTitle, treatment, treatmentType; ids such as treatmentTypeId stay.
  'title',
  'treatment',
  'treatmentType',
  'params', // the values a database query was sent; request and search parameters
  'url', // URLs and paths can carry patient link tokens
  'href',
  'link',
  'path',
  'token',
  'apiKey',
] as const;

/** Words that mark personal data wherever they appear in a name. */
export const PERSONAL_FIELD_WORDS = ['password', 'secret'] as const;

/*
 * Plurals (E00-T05b, from E01-T02b): a list holds what one value holds, so a field whose name ends
 * in a plural of an ending is personal too: every ending with `s` or `es` added (`patientNames`,
 * `phones`, `addresses`, `treatmentTypes`), and the three whose English plural is neither
 * (`requestBodies`, `diagnoses`, `datesOfBirth`). Such a field holding a list of records
 * (`recipients: [{ id, phone }]`) keeps only the records' ids in the logger (`[{ id }]`,
 * isPluralPersonalField, logger.ts); anything else it holds is dropped whole.
 */
const PLURAL_SUFFIXES = ['s', 'es'];
const IRREGULAR_PLURALS = ['bodies', 'diagnoses', 'datesOfBirth'];

/** Fields that look personal but are not. Compared as whole names. */
const NOT_PERSONAL = new Set(
  [
    'hostname', // pino's own field: the server's name
    // An AI call's counts of tokens (E06), numbers: not link tokens, which `tokens` drops.
    'inputTokens',
    'outputTokens',
  ].map(normalize),
);

const exact = new Set<string>(PERSONAL_FIELDS.map(normalize));
const endings = PERSONAL_FIELD_ENDINGS.map(normalize);
const plurals = [
  ...endings.flatMap((ending) => PLURAL_SUFFIXES.map((suffix) => ending + suffix)),
  ...IRREGULAR_PLURALS.map(normalize),
];
const words = PERSONAL_FIELD_WORDS.map(normalize);

function normalize(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** How a field's name marks it: not personal, personal, or personal only as a plural. */
function personalKind(field: string): 'none' | 'personal' | 'plural' {
  const key = normalize(field);
  if (NOT_PERSONAL.has(key)) return 'none';
  if (
    exact.has(key) ||
    endings.some((ending) => key.endsWith(ending)) ||
    words.some((word) => key.includes(word))
  ) {
    return 'personal';
  }
  return plurals.some((plural) => key.endsWith(plural)) ? 'plural' : 'none';
}

/** True if a field with this name may hold personal data: in the plural too. */
export function isPersonalField(field: string): boolean {
  return personalKind(field) !== 'none';
}

/**
 * True if a field with this name is personal only as the plural of an ending (`recipients`,
 * `phones`), not by a name, an ending or a word of its own (`notes` is an ending itself): the logger
 * keeps only the ids of such a field's records when it holds a list of records, and drops it
 * otherwise.
 */
export function isPluralPersonalField(field: string): boolean {
  return personalKind(field) === 'plural';
}
