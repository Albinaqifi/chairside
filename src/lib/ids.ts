/**
 * Primary keys are UUID version 7 (RFC 9562): a millisecond timestamp followed by random bits,
 * so new ids sort after old ones and indexes stay compact. Ids made in the same millisecond
 * are not ordered among themselves.
 */
export function newId(): string {
  return uuidv7(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
}

/** Builds a UUID v7 from a Unix time in milliseconds and 10 random bytes. */
export function uuidv7(unixMs: number, random: Uint8Array): string {
  if (!Number.isSafeInteger(unixMs) || unixMs < 0 || unixMs >= 2 ** 48) {
    throw new RangeError('uuidv7: unixMs must be an integer from 0 to 2^48 - 1');
  }
  if (random.length !== 10) throw new RangeError('uuidv7: needs exactly 10 random bytes');

  const bytes = new Uint8Array(16);
  let time = unixMs;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes.set(random, 6);
  bytes[6] = 0x70 | (random[0]! & 0x0f); // version 7
  bytes[8] = 0x80 | (random[2]! & 0x3f); // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a UUID in the canonical 8-4-4-4-12 hex form (any version). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
