import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_PREFIX } from '@/lib/cookies';
import { getAuth } from '@/modules/auth';

/**
 * Runs before every staff page and server action, and keeps the browser's session cookie in step
 * with the session (D-067):
 * - No session cookie: straight to the login page.
 * - Otherwise the auth library reads the session. This is the one place its end is moved forward
 *   (at most once a minute), and the renewed cookie the library sends with that move goes on this
 *   response, so the cookie ends when the session does: 30 minutes after the last request. A page
 *   cannot set cookies while it renders, so pages read the session without moving it
 *   (currentUser() in src/app/_lib/auth.ts).
 * - A session that has ended, or a cookie that names none: to the login page, with the cookie
 *   removal the library sends for an ended session.
 * A server action without a valid session is the exception: it goes on to its action, whose
 * wrapper runs nothing and sends the person to the login page itself (currentStaff()). The browser
 * would follow a redirect from here as a POST to /login, and a form posted without JavaScript would
 * then get Next.js's "Failed to find Server Action" error (500) instead of the login page.
 * The check every page and action relies on is still currentStaff(), which also settles the clinic.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const signedOut = () =>
    isServerAction(request)
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/login', request.url));
  if (!getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) return signedOut();

  // As a Response, so the library's Set-Cookie headers come with the answer. 401: the session was
  // removed while being moved forward (signed out in another tab).
  const answer = await getAuth().api.getSession({ headers: request.headers, asResponse: true });
  if (answer.status !== 200 && answer.status !== 401) {
    throw new Error(`The session could not be read (status ${answer.status}).`);
  }
  const session: unknown = answer.status === 200 ? await answer.json() : null;

  const response = session ? NextResponse.next() : signedOut();
  for (const cookie of answer.headers.getSetCookie()) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

/**
 * A server action call, as Next.js recognises one: a POST with the `Next-Action` header (the page
 * calling the action), or a form posted as multipart/form-data without JavaScript (the action's id
 * is a field of the form). Everything that reaches an action goes through an action wrapper (lint,
 * D-071), and every wrapper starts by checking the session.
 */
function isServerAction(request: NextRequest): boolean {
  if (request.method !== 'POST') return false;
  if (request.headers.has('next-action')) return true;
  return (request.headers.get('content-type') ?? '').startsWith('multipart/form-data');
}

export const config = {
  // Everything except the login page, the auth library's routes, the host's health check, Next.js
  // internals and files. The health check by its whole path (`$`), so `/api/healthz` or
  // `/api/health/x` still comes here, as before (E00-T07a): it needs no session and sets no cookie.
  matcher: ['/((?!login|api/auth|api/health$|_next/static|_next/image|favicon\\.ico|.*\\..*).*)'],
};
