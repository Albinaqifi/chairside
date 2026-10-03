/** Cookie names, in one place for the auth module, the request proxy (src/proxy.ts) and pages. */

/** The auth library's cookies are `chairside.session_token` and so on. */
export const AUTH_COOKIE_PREFIX = 'chairside';

/**
 * The clinic the signed-in user picked when they belong to several. Never trusted on its own:
 * it counts only if the user has an active membership in that clinic (resolveClinic).
 */
export const CLINIC_COOKIE = 'chairside.clinic';
