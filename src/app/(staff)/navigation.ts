import {
  can,
  type ClinicChoice,
  type MembershipExtras,
  type Permission,
  type Role,
} from '@/modules/auth';

/**
 * The staff app's navigation (scope-v1.md, "Navigation and roles"; demo lines 24–58): each item's
 * path, the group it is shown in (the demo's main list, and the one under the line), and what it
 * needs: every member, or any one of the permissions listed, read with can().
 *
 * Hiding an item is not the check (security-privacy.md, section 2): each real page checks its own
 * permission when it is built. Front desk and hygienists may read aftercare drafts and the library
 * (scope-v1.md, D-051); where they read them is E06's, which may widen Automations.
 *
 * Every path is one the request proxy runs for: it never starts with `login` and holds no dot
 * (src/proxy.ts, its matcher; tests/integration/staff-pages.test.ts).
 */
export const NAVIGATION = [
  { key: 'today', path: '/', group: 'main', needs: 'every_member' },
  { key: 'calendar', path: '/calendar', group: 'main', needs: ['calendar.manage'] },
  { key: 'visit', path: '/visit', group: 'main', needs: ['visit.record'] },
  { key: 'patients', path: '/patients', group: 'main', needs: ['patients.manage'] },
  {
    key: 'automations',
    path: '/automations',
    group: 'main',
    needs: ['automations.manage', 'aftercare.approve'],
  },
  { key: 'import', path: '/import', group: 'more', needs: ['import.run'] },
  { key: 'settings', path: '/settings', group: 'more', needs: ['settings.manage'] },
] as const satisfies readonly {
  key: string;
  path: string;
  group: 'main' | 'more';
  needs: 'every_member' | readonly [Permission, ...Permission[]];
}[];

type NavigationEntry = (typeof NAVIGATION)[number];

/** An item of the navigation as the sidebar shows it; its label is `nav.<key>` in the message file. */
export interface NavItem {
  key: NavigationEntry['key'];
  path: NavigationEntry['path'];
  group: NavigationEntry['group'];
}

/** The items a member with this role and these extras may use, in the navigation's order. */
export function navigationFor(role: Role, extras: MembershipExtras): NavItem[] {
  return NAVIGATION.filter(
    (entry) =>
      entry.needs === 'every_member' ||
      entry.needs.some((permission) => can(role, extras, permission)),
  ).map(({ key, path, group }) => ({ key, path, group }));
}

/**
 * What a membership adds to its role: its extra permissions, and the kind of the provider it is
 * linked to, or null, from clinics_for_user() (D-091). allowed() (src/app/_lib/actions.ts) reads
 * the same two.
 */
export function membershipExtras(clinic: ClinicChoice): MembershipExtras {
  return { extraPermissions: clinic.extraPermissions, providerKind: clinic.providerKind };
}
