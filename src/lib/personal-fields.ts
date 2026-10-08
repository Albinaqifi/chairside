/**
 * Field names that hold personal data. The logger drops these fields before anything is
 * written. Names are compared after lower-casing and removing everything but letters and
 * digits, so `firstName`, `first_name` and `FIRST-NAME` are the same field.
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

/** Fields that look personal but are not. */
const NOT_PERSONAL = new Set(['hostname']); // pino's own field: the server's name

const exact = new Set<string>(PERSONAL_FIELDS.map(normalize));
const endings = PERSONAL_FIELD_ENDINGS.map(normalize);
const words = PERSONAL_FIELD_WORDS.map(normalize);

function normalize(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True if a field with this name may hold personal data. */
export function isPersonalField(field: string): boolean {
  const key = normalize(field);
  if (NOT_PERSONAL.has(key)) return false;
  return (
    exact.has(key) ||
    endings.some((ending) => key.endsWith(ending)) ||
    words.some((word) => key.includes(word))
  );
}
