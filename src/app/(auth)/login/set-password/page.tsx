import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PASSWORD_LENGTH, SETUP_LINK_DAYS } from '@/modules/auth';
import { SetPasswordForm } from './set-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('setPassword');
  return { title: t('title') };
}

/**
 * Public on purpose (D-101): the page a setup link opens (`pnpm clinic:create`, E00-T05b), where a
 * person without a password yet chooses theirs. They have no session, so it checks none, and it
 * reads and shows no data. Opening it changes nothing: the link's token stays after `#`, which the
 * browser never sends, until the form sends it with the new password to the auth library, which
 * checks it. Beside the login page, so the request proxy lets it through untouched (src/proxy.ts).
 */
export default async function SetPasswordPage() {
  const t = await getTranslations('setPassword');
  return (
    <>
      <h1 className="font-serif text-heading tracking-heading">{t('heading')}</h1>
      <p className="mt-1 text-muted">{t('intro')}</p>
      <SetPasswordForm
        length={{ min: PASSWORD_LENGTH.min, max: PASSWORD_LENGTH.max }}
        linkDays={SETUP_LINK_DAYS}
      />
    </>
  );
}
