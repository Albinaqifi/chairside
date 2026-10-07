'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

/*
 * The clinic the staff frame names (D-069, E00-T04c). The frame is the staff layout: the sidebar,
 * which shows the clinic's name. Every form under it sends this clinic's id with its action, never
 * one a page passes, so a person only ever acts in the clinic they see named.
 *
 * A layout does not render again when a sidebar link opens another page. After another tab
 * switched clinic, the frame can still name clinic A above a page rendered for clinic B: a form
 * there sends A, and the wrapper answers clinic_changed with nothing run. PageClinic, which every
 * staff page renders, then refreshes the frame, so its name catches up with the page.
 */

const FrameClinicContext = createContext<string | null>(null);

/** Placed by the staff layout around everything it renders, with the clinic it rendered for. */
export function FrameClinic({ clinicId, children }: { clinicId: string; children: ReactNode }) {
  return <FrameClinicContext value={clinicId}>{children}</FrameClinicContext>;
}

/** The id of the clinic the frame names. Outside the staff layout there is none: an error. */
export function useFrameClinic(): string {
  const clinicId = useContext(FrameClinicContext);
  if (clinicId === null) {
    throw new Error('useFrameClinic: a staff form is rendered outside the staff layout');
  }
  return clinicId;
}

/** True when a page was rendered for another clinic than the frame around it names. */
export function framesAnotherClinic(frameClinicId: string | null, pageClinicId: string): boolean {
  return frameClinicId !== null && frameClinicId !== pageClinicId;
}

/**
 * Rendered by every staff page with the clinic it was rendered for (currentStaff()). When the frame
 * names another clinic, it refreshes the frame: router.refresh() renders the layout again on the
 * server, for the clinic now chosen, and keeps what the page holds in the browser (E00-T04b review
 * suggestion 1). It shows nothing.
 */
export function PageClinic({ clinicId }: { clinicId: string }) {
  const frameClinicId = useContext(FrameClinicContext);
  const router = useRouter();
  useEffect(() => {
    if (framesAnotherClinic(frameClinicId, clinicId)) router.refresh();
  }, [frameClinicId, clinicId, router]);
  return null;
}
