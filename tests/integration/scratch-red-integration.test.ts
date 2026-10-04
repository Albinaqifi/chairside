import { describe, expect, it } from 'vitest';

// Scratch pull request only (E00-T06a tester): an integration test that fails on purpose.
describe('scratch: a failing integration test', () => {
  it('fails in pnpm test:integration', () => {
    expect(1 + 1).toBe(3);
  });
});
