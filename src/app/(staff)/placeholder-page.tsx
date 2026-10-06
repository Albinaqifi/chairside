import { getTranslations } from 'next-intl/server';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/ui/empty';

/**
 * What a staff page shows until it is built: its title, as the demo heads a page (a serif heading,
 * with the entry animation, demo line 64), and a "coming soon" empty state. It checks nothing: the
 * page that shows it starts from currentStaff().
 */
export async function PlaceholderPage({ heading }: { heading: string }) {
  const t = await getTranslations('placeholder');
  return (
    <div className="motion-safe:animate-enter">
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
