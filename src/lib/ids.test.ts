import { describe, expect, it } from 'vitest';
import { isUuid, newId, uuidv7 } from './ids';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  it('returns a UUID version 7 with the RFC 9562 variant', () => {
    for (let i = 0; i < 100; i++) expect(newId()).toMatch(UUID_V7);
  });

  it('carries the current time in its first 48 bits', () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const time = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
    expect(ids.size).toBe(10_000);
  });
});

describe('uuidv7', () => {
  it('lays out timestamp, version and variant bits exactly', () => {
    expect(uuidv7(0x0123456789ab, new Uint8Array(10))).toBe('01234567-89ab-7000-8000-000000000000');
    expect(uuidv7(0x0123456789ab, new Uint8Array(10).fill(0xff))).toBe(
      '01234567-89ab-7fff-bfff-ffffffffffff',
    );
  });

  it('sorts by time: a later millisecond always gives a larger id', () => {
    const times = [0, 1, 255, 256, 1_700_000_000_000, 1_700_000_000_001, 2 ** 48 - 1];
    const ids = times.map((t) => uuidv7(t, new Uint8Array(10).fill(0xff - (t % 256))));
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejects out-of-range input', () => {
    expect(() => uuidv7(-1, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidv7(2 ** 48, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidv7(1.5, new Uint8Array(10))).toThrow(RangeError);
    expect(() => uuidv7(0, new Uint8Array(9))).toThrow(RangeError);
  });
});

describe('isUuid', () => {
  it('accepts canonical UUIDs of any version', () => {
    expect(isUuid(newId())).toBe(true);
    expect(isUuid('6F9619FF-8B86-D011-B42D-00C04FC964FF')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of [
      '',
      'abc',
      `${newId()} `,
      newId().replace(/-/g, ''),
      null,
      42,
      undefined,
    ]) {
      expect(isUuid(value)).toBe(false);
    }
  });
});
