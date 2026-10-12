import { unstable_rethrow } from 'next/navigation';
import type { StaffAction } from '@/app/_lib/actions';
import type { CalendarDay } from '@/lib/calendar-day';
import type { CalendarRead } from './day';

/*
 * A fresh day when the calendar is used (E01-T04b; owner, D-108): the page reads its day again when
 * the window regains focus or becomes visible, or a pointer, a key or a touch is used on it, at most
 * once every 30 seconds after its last read. Never on a timer: a page nobody touches asks the server
 * nothing, so the 30-minute sign-out holds (D-067, security-privacy.md section 2). No React here, so
 * the rules and the answers are unit-tested; ./calendar-screen.tsx listens and keeps the state.
 */

/** The least time between two reads of the day, from the start of the last one. */
export const READ_AGAIN_AFTER_MS = 30_000;

/**
 * What counts as using the page, on its window: a pointer pressed, moved or turned (a mouse, a pen, a
 * finger), a key, a touch. Each only asks whether a read is due: one read at most every 30 seconds.
 */
export const USE_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'] as const;

/**
 * True when the day may be read again: 30 seconds have passed since the last read started, or the
 * browser's clock went back since (it was set back): waiting for the old time to come again could
 * take hours.
 */
export function readIsDue(lastReadAt: number, now: number): boolean {
  return now - lastReadAt >= READ_AGAIN_AFTER_MS || now < lastReadAt;
}

export type ReadAnswer =
  /** The day as it is now. */
  | { kind: 'read'; read: CalendarRead }
  /** Another tab switched clinic (D-069): nothing was read, and the page should be reloaded. */
  | { kind: 'clinic_changed' }
  /** `internal`, or the call never got an answer (the network, the server restarting). */
  | { kind: 'failed' };

/**
 * Reads the day again: the day the page's address asks for, or null for the clinic's today (so a
 * page left on today shows the new day after midnight), with the frame's clinic (D-092), never one a
 * page passes. Next.js's redirect after an ended session (the login page) is Next.js's to carry out,
 * as for the patient search (../patients/search-answer.ts, D-074).
 */
export async function readAgain(
  read: StaffAction<{ day: CalendarDay | null }, CalendarRead>,
  clinicId: string,
  day: CalendarDay | null,
): Promise<ReadAnswer> {
  try {
    const result = await read(clinicId, { day });
    if (result.ok) return { kind: 'read', read: result.value };
    return result.error.code === 'clinic_changed' ? { kind: 'clinic_changed' } : { kind: 'failed' };
  } catch (error) {
    unstable_rethrow(error);
    return { kind: 'failed' };
  }
}
