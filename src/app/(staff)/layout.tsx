import type { ReactNode } from 'react';
import { currentStaff } from '@/app/_lib/auth';
import { Sidebar } from './sidebar';

/**
 * Everything under (staff) needs a signed-in user with a clinic. A layout does not re-render on
 * navigation (Next.js, "Layouts and auth checks"), so every page and action under it calls
 * currentStaff() too; it is memoised per request, so this costs nothing extra.
 *
 * The frame of every staff page, as the demo draws it (lines 22–60): the sidebar, then the content
 * area with the design reference's padding (28 px above, 36 px at the sides, 60 px below) and its
 * width, at most about 1,240 px (design-reference.md, "Layout").
 */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  const staff = await currentStaff();
  return (
    <div className="flex min-h-dvh">
      <Sidebar staff={staff} />
      <main className="min-w-0 flex-1 px-9 pt-7 pb-15">
        <div className="max-w-310">{children}</div>
      </main>
    </div>
  );
}
