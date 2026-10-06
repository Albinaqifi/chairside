import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PlaceholderPage } from '../placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.automations') }) };
}

/**
 * Automations: a placeholder until its rules, care plans and aftercare (E05, E06), each of which
 * checks its own permission (security-privacy.md, section 2).
 */
export default async function AutomationsPage() {
  await currentStaff();
  const t = await getTranslations('nav');
  return <PlaceholderPage heading={t('automations')} />;
}
