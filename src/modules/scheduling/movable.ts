import type { AppointmentStatus } from './appointments';

/**
 * The statuses whose visits the desk can move (E01-T06c): a booked or a confirmed one. An arrived
 * visit is in the chair; a completed one is done; a cancelled or no-show one is restored, not moved
 * (E01-T06f).
 */
export const MOVABLE_STATUSES = ['booked', 'confirmed'] satisfies AppointmentStatus[];
export type MovableStatus = (typeof MOVABLE_STATUSES)[number];

/**
 * True when a visit of that status can be moved. The one place that says so: the move checks it, and
 * the calendar's read gives it to each block (`movable`), so the drawer never works it out (D-123).
 */
export function movable(status: string): status is MovableStatus {
  return (MOVABLE_STATUSES as readonly string[]).includes(status);
}
