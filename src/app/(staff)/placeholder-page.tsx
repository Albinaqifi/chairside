import { getTranslations } from 'next-intl/server';
import { currentStaff } from '@/app/_lib/auth';
import { PageClinic } from '@/app/_lib/frame-clinic';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/ui/empty';

/**
 * What a staff page shows until it is built: its title, as the demo heads a page (a serif heading,
 * with the entry animation, demo line 64), and a "coming soon" empty state. The page that shows it
 * starts from currentStaff(), which is memoised per request: here it only gives the clinic the page
 * was rendered for, so the frame catches up when it names another (PageClinic, D-069).
 */
export async function PlaceholderPage({ heading }: { heading: string }) {
  const staff = await currentStaff();
  const t = await getTranslations('placeholder');
  return (
    <div className="motion-safe:animate-enter">
      <PageClinic clinicId={staff.clinic.clinicId} />
      <h1 className="font-serif text-heading tracking-heading">{heading}</h1>
      <Empty className="mt-6">
        <EmptyHeader>
          <EmptyTitle>{t('title')}</EmptyTitle>
          <EmptyDescription>{t('description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
