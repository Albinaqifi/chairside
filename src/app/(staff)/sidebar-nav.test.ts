import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavItem } from './navigation';
import { isCurrentPath } from './sidebar-item';
import { SidebarNav } from './sidebar-nav';

// usePathname() needs the App Router, which only Next.js mounts: here it answers the path a test
// sets. The texts come from next-intl, which only the app's layout provides: each text is its key.
const browser = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => browser.pathname }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const OWNER: NavItem[] = [
  { key: 'today', path: '/', group: 'main' },
  { key: 'calendar', path: '/calendar', group: 'main' },
  { key: 'patients', path: '/patients', group: 'main' },
  { key: 'automations', path: '/automations', group: 'main' },
  { key: 'import', path: '/import', group: 'more' },
  { key: 'settings', path: '/settings', group: 'more' },
];
const FRONT_DESK: NavItem[] = [
  { key: 'today', path: '/', group: 'main' },
  { key: 'calendar', path: '/calendar', group: 'main' },
  { key: 'visit', path: '/visit', group: 'main' },
  { key: 'patients', path: '/patients', group: 'main' },
];

/** The links of the navigation as the server renders them: where each goes, and its aria-current. */
function links(items: NavItem[]): { href: string; current: string | undefined }[] {
  const html = renderToString(createElement(SidebarNav, { items }));
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(([, attributes = '']) => ({
    href: /\bhref="([^"]*)"/.exec(attributes)?.[1] ?? '',
    current: /\baria-current="([^"]*)"/.exec(attributes)?.[1],
  }));
}

beforeEach(() => {
  browser.pathname = '/';
});

describe('the current page in the navigation (E00-T04b, acceptance 3)', () => {
  it.each([
    { pathname: '/', current: '/' },
    { pathname: '/calendar', current: '/calendar' },
    { pathname: '/patients', current: '/patients' },
    { pathname: '/patients/0197a1b2-0000-7000-8000-000000000001', current: '/patients' },
    { pathname: '/settings', current: '/settings' },
  ])('on $pathname, only the link to $current has aria-current="page"', ({ pathname, current }) => {
    browser.pathname = pathname;
    const marked = links(OWNER).filter((link) => link.current !== undefined);
    expect(marked).toEqual([{ href: current, current: 'page' }]);
  });

  it('on a page that is no item (the clinic picker), no link is marked', () => {
    browser.pathname = '/choose-clinic';
    expect(links(OWNER).filter((link) => link.current !== undefined)).toEqual([]);
  });

  it('renders one link per item, in order, to its path', () => {
    expect(links(OWNER).map((link) => link.href)).toEqual(OWNER.map((item) => item.path));
  });

  it('draws the line between the two lists only when the second one has an item', () => {
    const line = /<div aria-hidden="true"/g;
    expect(renderToString(createElement(SidebarNav, { items: OWNER })).match(line)).toHaveLength(1);
    expect(renderToString(createElement(SidebarNav, { items: FRONT_DESK })).match(line)).toBeNull();
  });

  it('names the navigation from the message file', () => {
    expect(renderToString(createElement(SidebarNav, { items: OWNER }))).toContain(
      '<nav aria-label="shell.navigation">',
    );
  });
});

describe('isCurrentPath(pathname, path)', () => {
  it.each([
    { pathname: '/', path: '/', current: true },
    { pathname: '/calendar', path: '/', current: false },
    { pathname: '/calendar', path: '/calendar', current: true },
    { pathname: '/calendar/week', path: '/calendar', current: true },
    { pathname: '/calendarx', path: '/calendar', current: false },
    { pathname: '/visit', path: '/calendar', current: false },
    { pathname: '/import', path: '/import', current: true },
    { pathname: '/imports', path: '/import', current: false },
  ])('$pathname belongs to $path: $current', ({ pathname, path, current }) => {
    expect(isCurrentPath(pathname, path)).toBe(current);
  });
});
