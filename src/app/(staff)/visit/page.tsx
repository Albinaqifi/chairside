import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PlaceholderPage } from '../placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.visit') }) };
}

/**
 * In the chair: a placeholder until the visit wrap-up (E06-T03), which checks visit.record itself
 * (security-privacy.md, section 2).
 */
export default async function VisitPage() {
  await currentStaff();
  const t = await getTranslations('nav');
  return <PlaceholderPage heading={t('visit')} />;
}
