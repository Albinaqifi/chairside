import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/modules/auth';

// Every /api/auth/* request is handled by the auth library: sign-in, sign-out, get-session.
// Login and 2FA (E04) use these routes from the browser; no code of ours handles passwords.
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
