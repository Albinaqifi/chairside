'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/ui/cn';
import type { NavItem } from './navigation';
import { isCurrentPath, sidebarItemClass } from './sidebar-item';

/**
 * The navigation's links (demo lines 31–44): the main list, then a line and the second list (Import
 * patients, Settings) when the person may use any of it. The current page's item has the demo's
 * current look and aria-current="page". A client component, because the staff layout does not
 * re-render on navigation and usePathname() does (Next.js, link.md, "Checking active links"). The
 * links keep their default prefetch.
 */
export function SidebarNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const t = useTranslations();
  const groups = [
    items.filter((item) => item.group === 'main'),
    items.filter((item) => item.group === 'more'),
  ].filter((group) => group.length > 0);

  return (
    <nav aria-label={t('shell.navigation')}>
      {groups.map((group, index) => (
        <div key={group[0]?.key}>
          {index > 0 && <div aria-hidden="true" className="mx-1.5 my-4 h-px bg-border" />}
          <ul className="flex flex-col gap-0.5">
            {group.map((item) => {
              const current = isCurrentPath(pathname, item.path);
              return (
                <li key={item.key}>
                  <Link
                    href={item.path}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      sidebarItemClass,
                      current
                        ? 'bg-primary-soft font-semibold text-nav-current-text'
                        : 'font-medium text-nav-text',
                    )}
                  >
                    {t(`nav.${item.key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
