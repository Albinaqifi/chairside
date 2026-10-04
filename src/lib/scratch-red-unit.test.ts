import { describe, expect, it } from 'vitest';

// Scratch pull request only (E00-T06a tester): a unit test that fails on purpose.
describe('scratch: a failing unit test', () => {
  it('fails in pnpm test', () => {
    expect(1 + 1).toBe(3);
  });
});
