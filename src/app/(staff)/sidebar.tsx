import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Staff } from '@/app/_lib/auth';
import { LogoutButton } from '@/app/_lib/logout-button';
import { cn } from '@/ui/cn';
import { Logo } from '@/ui/logo';
import { membershipExtras, navigationFor } from './navigation';
import { sidebarItemClass } from './sidebar-item';
import { SidebarNav } from './sidebar-nav';

/**
 * The staff app's sidebar (demo lines 24–58): 228 px, fixed while the page scrolls. The logo mark
 * and the wordmark, the clinic's name (wrapped however long it is), the navigation the person's role
 * allows, and at the foot who is signed in, "Switch clinic" when they belong to more than one
 * clinic, and logout. The demo's "Patient's phone" and its "Signed in as" switcher are demo
 * devices and are not built (scope-v1.md, "Navigation and roles"): the person's own name and role
 * stand where the switcher's choices stood.
 */
export async function Sidebar({ staff }: { staff: Staff }) {
  const t = await getTranslations();
  const items = navigationFor(staff.clinic.role, membershipExtras(staff.clinic));
  const footItem = cn(sidebarItemClass, 'font-medium text-nav-text');

  return (
    <aside className="sticky top-0 flex h-dvh w-57 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar px-3.5 py-5">
      <div className="px-2 pb-1">
        <Logo />
      </div>
      <p className="pt-0.5 pr-2 pb-5 pl-11.5 text-caption text-muted wrap-anywhere">
        {staff.clinic.clinicName}
      </p>
      <SidebarNav items={items} />
      <div className="mt-auto flex shrink-0 flex-col gap-2 pt-4">
        <p className="px-1.5 text-overline tracking-overline text-muted uppercase">
          {t('shell.signedInAs')}
        </p>
        <div className="rounded-control border border-border bg-surface px-3.25 py-2.75">
          <p className="text-small font-semibold wrap-anywhere">{staff.user.name}</p>
          <p className="text-caption text-muted">{t(`roles.${staff.clinic.role}`)}</p>
        </div>
        <div className="flex flex-col gap-0.5">
          {staff.clinicCount > 1 && (
            <Link href="/choose-clinic" className={footItem}>
              {t('shell.switchClinic')}
            </Link>
          )}
          <LogoutButton
            className={cn(footItem, 'h-auto border-0 transition-none hover:text-nav-text')}
          />
        </div>
      </div>
    </aside>
  );
}
