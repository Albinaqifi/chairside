import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { APP, FRONT_DESK_SESSION, SIGNED_OUT } from './servers.ts';

// E00-T07a, acceptance 5: `/api/health` on the production build (`next start`), asked as a host asks
// it, with no browser: no session needed, no cookie set, never cached, GET alone. And the request
// proxy, whose matcher now lets the check through, still sends a signed-out request for a staff page,
// or for a path that only starts like the check's, to the login page. When it answers 503:
// tests/integration/health.test.ts.

/** Asks the production build with no browser: with no session, or with the front desk's. */
async function asker(storageState: string | typeof SIGNED_OUT): Promise<APIRequestContext> {
  return request.newContext({ baseURL: APP, storageState });
}

/** The Set-Cookie headers of an answer. */
const setCookies = (answer: APIResponse) =>
  answer.headersArray().filter(({ name }) => name.toLowerCase() === 'set-cookie');

test('answers 200 to a GET without a session, sets no cookie and is never cached', async () => {
  const host = await asker(SIGNED_OUT);
  try {
    const answer = await host.get('/api/health', { maxRedirects: 0 });
    expect(answer.status()).toBe(200);
    expect(await answer.json()).toEqual({ ok: true });
    expect(answer.headers()['cache-control']).toBe('no-store');
    expect(setCookies(answer)).toEqual([]);
  } finally {
    await host.dispose();
  }
});

test("reads no session: with the front desk's, it answers the same and sets no cookie", async () => {
  const signedIn = await asker(FRONT_DESK_SESSION);
  try {
    const answer = await signedIn.get('/api/health', { maxRedirects: 0 });
    expect(answer.status()).toBe(200);
    expect(answer.headers()['cache-control']).toBe('no-store');
    expect(setCookies(answer)).toEqual([]);
  } finally {
    await signedIn.dispose();
  }
});

test('refuses a POST', async () => {
  const host = await asker(SIGNED_OUT);
  try {
    const answer = await host.post('/api/health', { maxRedirects: 0, data: {} });
    expect(answer.status()).toBe(405);
    expect(setCookies(answer)).toEqual([]);
  } finally {
    await host.dispose();
  }
});

test('sends a signed-out request for a staff page to /login as before, and every path that only starts like the check', async () => {
  const signedOut = await asker(SIGNED_OUT);
  try {
    for (const path of ['/', '/patients', '/api/healthz', '/api/health/x']) {
      const answer = await signedOut.get(path, { maxRedirects: 0 });
      expect(answer.status(), path).toBe(307);
      // Next.js writes a redirect to the same origin as a path.
      expect(new URL(answer.headers()['location'] ?? '', APP).href, path).toBe(`${APP}/login`);
    }
  } finally {
    await signedOut.dispose();
  }
});
