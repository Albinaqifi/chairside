import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { asFormAction } from '@/app/_lib/actions';
import { requireUser } from '@/app/_lib/auth';
import { LogoutButton } from '@/app/_lib/logout-button';
import { clinicsForUser } from '@/modules/auth';
import { Button } from '@/ui/button';
import { chooseClinic } from './actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('chooseClinic');
  return { title: t('title') };
}

/** Shown to a signed-in user who belongs to several clinics, or to none. */
export default async function ChooseClinicPage() {
  const user = await requireUser();
  const choices = await clinicsForUser(user.id);
  if (choices.length === 1) redirect('/');
  const t = await getTranslations();
  return (
    <>
      {choices.length === 0 ? (
        <>
          <h1 className="font-serif text-heading tracking-heading">
            {t('chooseClinic.noClinicHeading')}
          </h1>
          <p className="mt-1 text-muted">{t('chooseClinic.noClinic')}</p>
        </>
      ) : (
        <>
          <h1 className="font-serif text-heading tracking-heading">{t('chooseClinic.heading')}</h1>
          <p className="mt-1 text-muted">{t('chooseClinic.intro')}</p>
          <ul className="mt-6 grid gap-2">
            {choices.map((choice) => (
              <li key={choice.clinicId}>
                <form action={asFormAction(chooseClinic)}>
                  <input type="hidden" name="clinicId" value={choice.clinicId} />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="h-auto min-h-10 w-full justify-between py-2 text-left whitespace-normal"
                  >
                    <span className="min-w-0">{choice.clinicName}</span>
                    <span className="shrink-0 font-normal text-muted">
                      {t(`roles.${choice.role}`)}
                    </span>
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-6 flex justify-center border-t border-border pt-4">
        <LogoutButton />
      </div>
    </>
  );
}
