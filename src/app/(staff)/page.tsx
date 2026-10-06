import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';

// Placeholder until the staff shell exists (E00-T04b) and the schedule (E01).
export default async function Home() {
  const staff = await currentStaff();
  const t = await getTranslations('today');
  return (
    <>
      <h1>{t('heading')}</h1>
      <p>{t('placeholder', { clinic: staff.clinic.clinicName })}</p>
    </>
  );
}
