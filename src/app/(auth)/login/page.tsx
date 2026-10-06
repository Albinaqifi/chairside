import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { currentUser } from '@/app/_lib/auth';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('login');
  return { title: t('title') };
}

/**
 * Public on purpose: anyone may open the login page, so it checks no session and shows no data
 * (security-privacy.md section 2). It only sends a person who is already signed in on to the app.
 */
export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  const t = await getTranslations('login');
  return (
    <>
      <h1 className="font-serif text-heading tracking-heading">{t('heading')}</h1>
      <p className="mt-1 text-muted">{t('intro')}</p>
      <LoginForm />
    </>
  );
}
