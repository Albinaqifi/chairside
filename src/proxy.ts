import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE_PREFIX } from '@/lib/cookies';

/**
 * A quick check before any staff page renders: no session cookie, straight to the login page.
 * It only looks at the cookie's presence (an "optimistic check" in the Next.js guide). The real
 * check, against the database, is currentStaff() in src/app/_lib/auth.ts, which every staff page
 * and action calls.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except the login page, the auth library's routes, Next.js internals and files.
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon\\.ico|.*\\..*).*)'],
};
