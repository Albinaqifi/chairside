import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PlaceholderPage } from '../placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.calendar') }) };
}

/**
 * The calendar: a placeholder until its day and week views (E01-T04, E01-T07), which check
 * calendar.manage themselves (security-privacy.md, section 2).
 */
export default async function CalendarPage() {
  await currentStaff();
  const t = await getTranslations('nav');
  return <PlaceholderPage heading={t('calendar')} />;
}
