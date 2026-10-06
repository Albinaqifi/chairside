import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PlaceholderPage } from '../placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.import') }) };
}

/**
 * Import patients: a placeholder until the import (E04-T04 to E04-T08), which checks import.run
 * itself (security-privacy.md, section 2).
 */
export default async function ImportPage() {
  await currentStaff();
  const t = await getTranslations('nav');
  return <PlaceholderPage heading={t('import')} />;
}
