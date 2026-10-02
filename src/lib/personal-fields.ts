/**
 * Field names that hold personal data. The logger drops these fields before anything is
 * written. Matching ignores case, `_` and `-`: `firstName`, `first_name` and `FIRST-NAME` are
 * the same field.
 *
 * Add a name when a new kind of personal data appears. Never remove one to make a log line
 * work: log an id instead.
 */
export const PERSONAL_FIELDS = [
  // Names
  'name',
  'firstName',
  'lastName',
  'middleName',
  'fullName',
  'displayName',
  'guardianName',
  // Contact details
  'email',
  'phone',
  'phoneNumber',
  'mobile',
  'address',
  'street',
  'city',
  'postalCode',
  // Identity and health
  'dateOfBirth',
  'birthDate',
  'dob',
  'embg', // North Macedonian personal identification number
  'nationalId',
  'notes',
  'note',
  'comment',
  // Message content
  'body',
  'text',
  'html',
  'subject',
  'content',
  'messageBody',
  // Secrets
  'password',
  'token',
  'secret',
  'apiKey',
  'cookie',
  'authorization',
  // Postgres error details: they quote row values, e.g. "Key (email)=(...) already exists"
  'detail',
] as const;

const normalized = new Set(PERSONAL_FIELDS.map(normalize));

function normalize(field: string): string {
  return field.toLowerCase().replace(/[_-]/g, '');
}

/** True if a field with this name may hold personal data. */
export function isPersonalField(field: string): boolean {
  return normalized.has(normalize(field));
}
