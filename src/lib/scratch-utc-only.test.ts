import { describe, expect, it } from 'vitest';

// Scratch pull request only (E00-T06a tester): a test that passes only when the process runs in
// UTC. 1970-01-01T00:00Z is 00:00 in UTC and 12:00 in Auckland (NZST, +12; no summer time then).
describe('scratch: a test that depends on the server time zone', () => {
  it('reads the hour of the Unix epoch in the local zone', () => {
    expect(new Date(0).getHours()).toBe(0);
  });
});
