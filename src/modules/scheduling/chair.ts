import { and, eq, gt, lt, ne, notInArray, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import type { AppointmentStatus } from './appointments';
import { appointments } from './schema';

/**
 * The statuses whose visits no longer hold the chair: no booking is refused for one (data-model.md,
 * "No double booking").
 */
export const CHAIR_FREED = ['cancelled', 'no_show'] satisfies AppointmentStatus[];

/**
 * A moment as a query takes it: a SQL expression (the booking keeps its moments in SQL, from the
 * check to the insert) or a Date read from a row (a restore).
 */
export type Moment = SQL | Date;

/**
 * True when the patient already has a visit with the provider at that start that holds the chair:
 * the same booking again (E01-T05b). Shared by the booking and by a restore (E01-T06a), so one
 * rule says what "the same visit" is. The caller holds the provider's row (`for update`) first.
 *
 * `exceptId` leaves one visit out: the visit a move (E01-T06c) is moving holds the chair at its old
 * place, and must not be found as the visit it is moving to. A booking and a restore pass none.
 */
export async function sameVisitHoldsChair(
  tx: TenantTransaction,
  visit: { patientId: string; providerId: string; startsAt: Moment },
  exceptId?: string,
): Promise<boolean> {
  const [same] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.patientId, visit.patientId),
        eq(appointments.providerId, visit.providerId),
        notInArray(appointments.status, CHAIR_FREED),
        eq(appointments.startsAt, visit.startsAt),
        exceptId === undefined ? undefined : ne(appointments.id, exceptId),
      ),
    )
    .limit(1);
  return same !== undefined;
}

/**
 * True when another visit of the provider holds the chair at any moment of `startsAt` to `endsAt`:
 * of every status but cancelled and no-show, one booked anyway (`overlap_ok`) too, which the
 * database's own constraint lets through. A visit that ends when this one starts, or starts when it
 * ends, does not overlap it. Shared by the booking and by a restore (E01-T06a); the caller holds the
 * provider's row (`for update`) first. A visit that does not hold the chair itself (the one being
 * restored is cancelled or a no-show) is never found. `exceptId` leaves one visit out, as in
 * sameVisitHoldsChair: the visit being moved (E01-T06c) overlaps its own old place.
 */
export async function chairClashes(
  tx: TenantTransaction,
  visit: { providerId: string; startsAt: Moment; endsAt: Moment },
  exceptId?: string,
): Promise<boolean> {
  const [clash] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.providerId, visit.providerId),
        notInArray(appointments.status, CHAIR_FREED),
        lt(appointments.startsAt, visit.endsAt),
        gt(appointments.endsAt, visit.startsAt),
        exceptId === undefined ? undefined : ne(appointments.id, exceptId),
      ),
    )
    .limit(1);
  return clash !== undefined;
}
