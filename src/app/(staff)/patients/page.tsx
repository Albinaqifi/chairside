import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PlaceholderPage } from '../placeholder-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('shell.pageTitle', { page: t('nav.patients') }) };
}

/**
 * Patients: a placeholder until the list (E01-T02), which checks patients.manage itself
 * (security-privacy.md, section 2).
 */
export default async function PatientsPage() {
  await currentStaff();
  const t = await getTranslations('nav');
  return <PlaceholderPage heading={t('patients')} />;
}
