'use server';

import { z } from 'zod';
import { clinicPlace } from '@/modules/tenancy';
import { staffRead } from './actions';

/**
 * The time zone of the clinic the request is in (clinics.timezone, D-015). src/i18n/request.ts
 * reads it with forPage for every page a member sees in a clinic, so every date and time is shown
 * in it, and next-intl's provider hands it to the client components. As a server action it gives a
 * member their own clinic's zone, nothing more.
 */
export const clinicTimeZone = staffRead(
  { permission: 'every_member', input: z.object({}) },
  async ({ tx }) => (await clinicPlace(tx)).timeZone,
);
