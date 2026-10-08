import { getRequestConfig } from 'next-intl/server';
import { settledStaff } from '@/app/_lib/auth';
import { clinicTimeZone } from '@/app/_lib/clinic-time-zone';
import messages from './en.json';

/**
 * The zone of a page that belongs to no clinic: the login page and the clinic picker, which show no
 * date or time.
 */
export const NO_CLINIC_TIME_ZONE = 'UTC';

/**
 * The time zone every date and time of this request is shown in (D-015): the clinic's, once the
 * clinic is settled as currentStaff() settles it, read in the clinic's own transaction (D-091);
 * otherwise NO_CLINIC_TIME_ZONE. This runs for every page, the login page and the clinic picker
 * too, so it sends no one anywhere: currentStaff() would. A read that fails fails the page, rather
 * than show times in the wrong zone.
 */
export async function requestTimeZone(): Promise<string> {
  if (!(await settledStaff())) return NO_CLINIC_TIME_ZONE;
  const read = await clinicTimeZone.forPage({});
  if (!read.ok) throw new Error(`The clinic's time zone could not be read (${read.error.code}).`);
  return read.value;
}

/**
 * next-intl's configuration for every request (D-015): English only, with no locale in the URL
 * (D-053), so one message file and no locale routing. next-intl needs no middleware then, and gets
 * none: the request proxy is src/proxy.ts (D-067). next.config.ts finds this file by its path. The
 * time zone set here reaches client components through the root layout's NextIntlClientProvider,
 * so the server and the browser show a visit at the same time, whatever their computers' zones.
 */
export default getRequestConfig(async () => ({
  locale: 'en',
  messages,
  timeZone: await requestTimeZone(),
}));
