import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { appointments, providers, treatmentTypes } from './schema';

/** The most completed visits a patient's history holds (E01-T03a). */
export const HISTORY_LIMIT = 20;

/**
 * A visit that is still to come: booked or confirmed, and not ended at `now`. A visit under way and
 * not yet marked arrived, or a patient who is late, still counts until it ends. One rule for the
 * patient list's next visit and the profile's (E01-T03a): both read it here.
 */
function upcoming(now: Date): SQL {
  return sql`${appointments.status} in ('booked', 'confirmed') and ${appointments.endsAt} > ${now}`;
}

/** A patient's last and next visit: the start of each, or null when there is none. */
export interface PatientVisits {
  /** The last completed appointment. */
  last: Date | null;
  /** The first booked or confirmed appointment that has not ended at `now`. */
  next: Date | null;
}

/**
 * The last and next visit of each of these patients, by patient id; a patient with neither is not
 * in the map. A visit under way and not yet marked arrived, or a patient who is late, still shows
 * as next until it ends. Cancelled visits and no-shows are neither.
 */
export async function lastAndNextVisits(
  tx: TenantTransaction,
  patientIds: readonly string[],
  now: Date,
): Promise<Map<string, PatientVisits>> {
  if (patientIds.length === 0) return new Map();
  const rows = await tx
    .select({
      patientId: appointments.patientId,
      last: sql<Date | null>`max(${appointments.startsAt}) filter (where ${appointments.status} = 'completed')`.mapWith(
        appointments.startsAt,
      ),
      next: sql<Date | null>`min(${appointments.startsAt}) filter (where ${upcoming(now)})`.mapWith(
        appointments.startsAt,
      ),
    })
    .from(appointments)
    .where(inArray(appointments.patientId, [...patientIds]))
    .groupBy(appointments.patientId);
  return new Map(rows.map(({ patientId, last, next }) => [patientId, { last, next }]));
}

/** One visit of a patient as the profile shows it. */
export interface PatientVisit {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** The appointment's label ("Filling 36"), shown when it has no treatment type. */
  title: string;
  /** The treatment type's name; null for an appointment without one. */
  treatmentName: string | null;
  providerName: string;
}

/** A patient's next visit and their history. */
export interface PatientVisitsOf {
  /** The first booked or confirmed visit that has not ended at `now`, or null. */
  next: PatientVisit | null;
  /** Completed visits, newest first, at most HISTORY_LIMIT. Cancelled visits and no-shows are not. */
  history: PatientVisit[];
}

/**
 * The next visit and the history of one patient (E01-T03a), each with its provider's and its
 * treatment type's name. The next visit is read by the rule `lastAndNextVisits` uses (upcoming). The
 * provider and the treatment type are this module's tables, so the names are joined here.
 */
export async function patientVisits(
  tx: TenantTransaction,
  patientId: string,
  now: Date,
): Promise<PatientVisitsOf> {
  const read = (where: SQL, order: SQL, limit: number) =>
    tx
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        title: appointments.title,
        treatmentName: treatmentTypes.name,
        providerName: providers.name,
      })
      .from(appointments)
      .innerJoin(providers, eq(providers.id, appointments.providerId))
      .leftJoin(treatmentTypes, eq(treatmentTypes.id, appointments.treatmentTypeId))
      .where(and(eq(appointments.patientId, patientId), where))
      .orderBy(order, asc(appointments.id))
      .limit(limit);
  const [next] = await read(upcoming(now), asc(appointments.startsAt), 1);
  const history = await read(
    sql`${appointments.status} = 'completed'`,
    desc(appointments.startsAt),
    HISTORY_LIMIT,
  );
  return { next: next ?? null, history };
}

/** The most visits ahead a patient's list holds (E01-T03b). */
export const VISITS_AHEAD_LIMIT = 20;

/** A visit that holds the chair of a patient and is not over, as the edit page lists it. */
export interface VisitAhead {
  id: string;
  startsAt: Date;
  /** The treatment type's name; the appointment's own label when it has none. */
  what: string;
  providerName: string;
}

/**
 * The visits that stand in the way of archiving a patient or marking them deceased (owner, D-114,
 * E01-T03b): booked, confirmed or arrived, and not ended at `now` (a visit under way and not yet
 * marked arrived still counts until it ends). Cancelled, no-show and completed visits do not hold the
 * chair, nor do visits that ended. Soonest first, at most VISITS_AHEAD_LIMIT, with the provider's
 * and the treatment type's name. (`visitsAhead` of providers.ts counts a provider's, not a patient's.)
 */
export async function patientVisitsAhead(
  tx: TenantTransaction,
  patientId: string,
  now: Date,
): Promise<VisitAhead[]> {
  const rows = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      title: appointments.title,
      treatmentName: treatmentTypes.name,
      providerName: providers.name,
    })
    .from(appointments)
    .innerJoin(providers, eq(providers.id, appointments.providerId))
    .leftJoin(treatmentTypes, eq(treatmentTypes.id, appointments.treatmentTypeId))
    .where(
      and(
        eq(appointments.patientId, patientId),
        sql`${appointments.status} in ('booked', 'confirmed', 'arrived') and ${appointments.endsAt} > ${now}`,
      ),
    )
    .orderBy(asc(appointments.startsAt), asc(appointments.id))
    .limit(VISITS_AHEAD_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt,
    what: row.treatmentName ?? row.title,
    providerName: row.providerName,
  }));
}
