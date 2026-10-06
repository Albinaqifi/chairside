/*
 * What the sidebar's items share: the navigation's links (sidebar-nav.tsx, a client component) and
 * the person's links under them (sidebar.tsx, a server component). A plain module, so both import
 * the same values: a value exported from a 'use client' file reaches a server component as a
 * reference to the client, not as the value.
 */

/**
 * Whether the page at `pathname` belongs to the item at `path`, as the demo marks a screen
 * (logic line 1778): Today only on `/`, every other item on its own path and the paths below it
 * (a patient's profile under Patients).
 */
export function isCurrentPath(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * A sidebar item, as the demo draws one (lines 33 and 42): 14 px, left-aligned, on the control
 * radius, with the hover tint. The demo's items are buttons, which keep the browser's normal line
 * height (about 1.2) rather than the page's 1.45: leading-tight keeps their 35 px height. Its text
 * colour and weight are the caller's: the navigation's colours for a link, darker and heavier for
 * the current page (logic line 1778). Keyboard focus draws an outline in the focus colour, as
 * Button does.
 */
export const sidebarItemClass =
  'flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-2.25 text-left text-base leading-tight outline-none hover:bg-nav-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus focus-visible:outline-solid';
