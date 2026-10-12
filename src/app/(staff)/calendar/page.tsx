import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { readCalendarDay } from './actions';
import { askedDay } from './day';
import { DayCalendar } from './day-calendar';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.calendar') }) };
}

/**
 * The calendar's day view (E01-T04a): one day of the clinic, the one its address names
 * (`?day=YYYY-MM-DD`) or the clinic's today, read when the page is opened and on each Previous,
 * Today and Next (E01-T04b reads it again when the calendar is used, D-108). The read checks
 * calendar.manage itself (readCalendarDay). The week view is E01-T07's.
 *
 * Nothing on the day keeps state in the browser yet, so nothing needs the clinic's key (D-098);
 * the page renders in place for another clinic with that clinic's day. Next.js always passes
 * `searchParams`; called without it, as a test may, the page shows today.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const staff = await currentStaff();
  const day = askedDay((await searchParams)?.day);
  const read = await readCalendarDay.forPage({ day });
  if (!read.ok) throw new Error(`The calendar could not be read (${read.error.code}).`);
  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <DayCalendar view={read.value} />
    </div>
  );
}
