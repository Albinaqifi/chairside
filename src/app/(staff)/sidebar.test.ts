import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Staff } from '@/app/_lib/auth';
import type { ExtraPermission, ProviderKind, Role } from '@/modules/auth';
import { Sidebar } from './sidebar';

// E00-T04b, tester: the sidebar as the staff layout renders it. navigation.test.ts lists each role's
// items from navigationFor(); these cases check that the sidebar reads them with the membership's
// own extras, and offers "Switch clinic" only to a member of more than one clinic. Next.js and
// next-intl run only in the app: here the path is Today's, the router does nothing and each text
// is its key. Every value is synthetic.
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next-intl/server', () => ({
  getTranslations: () => Promise.resolve((key: string) => key),
}));

function member(
  role: Role,
  extraPermissions: ExtraPermission[],
  clinicCount: number,
  providerKind: ProviderKind | null = null,
): Staff {
  return {
    user: {
      id: '01970000-0000-7000-8000-0000000000a1',
      name: 'Front desk',
      email: 'staff-sidebar@example.test',
    },
    clinic: {
      membershipId: '01970000-0000-7000-8000-0000000000a2',
      clinicId: '01970000-0000-7000-8000-0000000000a3',
      clinicName: 'Test clinic (synthetic)',
      role,
      extraPermissions,
      providerKind,
    },
    clinicCount,
  };
}

/** The sidebar's HTML as the server renders it, and where each of its links goes. */
async function render(staff: Staff): Promise<{ html: string; links: string[] }> {
  const html = renderToString(await Sidebar({ staff }));
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href = '']) => href);
  return { html, links };
}

describe('the sidebar (E00-T04b, tester)', () => {
  it("front desk with the import permission, in one clinic: the role's items with Import patients, no Switch clinic", async () => {
    const { links } = await render(member('front_desk', ['import'], 1));
    expect(links).toEqual(['/', '/calendar', '/visit', '/patients', '/import']);
  });

  it("an owner of two clinics: the owner's items, then Switch clinic", async () => {
    const { links } = await render(member('owner', [], 2));
    expect(links).toEqual([
      '/',
      '/calendar',
      '/patients',
      '/automations',
      '/import',
      '/settings',
      '/choose-clinic',
    ]);
  });

  it("an owner whose membership is linked to a dentist column (E01-T01a): the owner's items with In the chair", async () => {
    const { links } = await render(member('owner', [], 1, 'dentist'));
    expect(links).toEqual([
      '/',
      '/calendar',
      '/visit',
      '/patients',
      '/automations',
      '/import',
      '/settings',
    ]);
  });

  it("names the clinic, the person and the person's role, from the message file", async () => {
    const { html } = await render(member('hygienist', [], 1));
    expect(html).toContain('Test clinic (synthetic)');
    expect(html).toContain('Front desk');
    expect(html).toContain('roles.hygienist');
    expect(html).toContain('shell.signedInAs');
  });
});
