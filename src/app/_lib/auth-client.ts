import { createAuthClient } from 'better-auth/react';

/** The browser side of the auth library: it calls /api/auth/* on this origin. Client components only. */
export const authClient = createAuthClient();
