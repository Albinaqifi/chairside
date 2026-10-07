import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptSignOut } from './logout-button';

// E00-T04c, acceptance 4 (the logout button's part, below the browser): a logout that did not end
// the session says so, so the button shows its failure toast and works again; the tester checks
// the button in a browser, in the sidebar and in the clinic picker. The auth library's client is a
// stand-in that answers as each test says.

const client = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('./auth-client', () => ({ authClient: { signOut: client.signOut } }));

beforeEach(() => {
  client.signOut.mockReset();
});

describe('attemptSignOut', () => {
  it('signed out: true', async () => {
    client.signOut.mockResolvedValue({ data: { success: true }, error: null });
    expect(await attemptSignOut()).toBe(true);
  });

  it('the auth library answered with an error: false', async () => {
    client.signOut.mockResolvedValue({ data: null, error: { status: 500 } });
    expect(await attemptSignOut()).toBe(false);
  });

  it('a call that fails at the network (the promise rejects): false', async () => {
    client.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await attemptSignOut()).toBe(false);
  });
});
