import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { readCalendarDay } from './actions';
import { CalendarScreen } from './calendar-screen';
import { askedDay } from './day';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.calendar') }) };
}

/**
 * The calendar's day view (E01-T04a): one day of the clinic, the one its address names
 * (`?day=YYYY-MM-DD`) or the clinic's today, read when the page is opened and on each Previous,
 * Today and Next, and again in the browser when the calendar is used (E01-T04b, D-108). The read
 * checks calendar.manage itself (readCalendarDay), and gives the provider the member's membership is
 * linked to, whose column the calendar opens on. The week view is E01-T07's.
 *
 * The calendar keeps state in the browser made from the page's rows (the filter's choice, the day
 * read again), so it is keyed by the clinic the page was rendered for (D-098): a render in place for
 * another clinic starts it again with that clinic's day and columns. Next.js always passes
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
      <CalendarScreen key={staff.clinic.clinicId} initial={read.value} asked={day} />
    </div>
  );
}
