import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PlaceholderPage } from '../placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.settings') }) };
}

/**
 * Settings: a placeholder until the clinic's settings (E01-T08, E01-T09), which check
 * settings.manage themselves (security-privacy.md, section 2).
 */
export default async function SettingsPage() {
  await currentStaff();
  const t = await getTranslations('nav');
  return <PlaceholderPage heading={t('settings')} />;
}
