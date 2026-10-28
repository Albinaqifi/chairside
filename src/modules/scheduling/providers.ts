import { and, asc, count, eq, gt, notInArray, sql, type Column } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { appointments, providerBreaks, providers } from './schema';

/** One calendar column: a dentist, a hygienist or another provider (D-019). */
export interface Provider {
  id: string;
  name: string;
  shortName: string;
  /** The chair, a label on the provider (D-019). */
  chairLabel: string;
  /** The column's colour, a hue in degrees, 0–359: the theme derives its tints from it. */
  colorHue: number;
  /** An inactive provider keeps their appointments, and gets no new ones. */
  active: boolean;
}

/**
 * The clinic's providers, active or not, in the calendar's order: `sort_order`, then the name. The
 * calendar shows the active ones, and an inactive one with an appointment on the day it shows
 * (E01-T04a), so it reads them all.
 */
export async function listProviders(tx: TenantTransaction): Promise<Provider[]> {
  return tx
    .select({
      id: providers.id,
      name: providers.name,
      shortName: providers.shortName,
      chairLabel: providers.chairLabel,
      colorHue: providers.colorHue,
      active: providers.active,
    })
    .from(providers)
    .orderBy(asc(providers.sortOrder), asc(providers.name), asc(providers.id));
}

/** A weekly break of one provider, such as lunch (D-018), on the clinic's clock. */
export interface ProviderBreak {
  id: string;
  providerId: string;
  /** Minutes from midnight to its start, a local time in the clinic's zone: 720 is 12:00. */
  startMinute: number;
  /** Minutes from midnight to its end. */
  endMinute: number;
  label: string;
}

/**
 * The breaks of every provider on this ISO weekday (1 = Monday … 7 = Sunday), by start. A break is
 * a local time on that weekday, whatever the day's length: on the day the clocks change, lunch is
 * still from 12:00 to 13:00.
 */
export async function breaksOnWeekday(
  tx: TenantTransaction,
  weekday: number,
): Promise<ProviderBreak[]> {
  return tx
    .select({
      id: providerBreaks.id,
      providerId: providerBreaks.providerId,
      startMinute: minutesOfTime(providerBreaks.starts),
      endMinute: minutesOfTime(providerBreaks.ends),
      label: providerBreaks.label,
    })
    .from(providerBreaks)
    .where(eq(providerBreaks.weekday, weekday))
    .orderBy(asc(providerBreaks.starts), asc(providerBreaks.id));
}

/** A `time` column as minutes from midnight: seconds since midnight, over 60. */
function minutesOfTime(column: Column) {
  return sql<number>`(extract(epoch from ${column}) / 60)::float8`;
}

/*
 * The providers as Settings keeps them (E01-T09b, E01-T09d): every provider of the clinic with its
 * kind, one added, one changed, one made inactive and active again, one moved up or down (E01-T09c);
 * the breaks are E01-T09e. Never deleted (data-model.md: the app role has no DELETE on the table). A
 * provider's name, short name and chair are no patient's, but never go in a log or an error's
 * message either.
 */

/** A provider's kinds, as the table's check names them (data-model.md). */
export const PROVIDER_KINDS = ['dentist', 'hygienist', 'other'] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** The longest a provider's name may be, in characters, once trimmed. */
export const PROVIDER_NAME_MAX = 100;

/** The longest a provider's short name may be, in characters, once trimmed: the calendar's chips. */
export const PROVIDER_SHORT_NAME_MAX = 12;

/** The longest a provider's chair label may be, in characters, once trimmed. */
export const PROVIDER_CHAIR_MAX = 100;

/** The highest hue a provider's colour may have, in degrees: the table's check is 0–359. */
export const PROVIDER_HUE_MAX = 359;

/**
 * One provider as the Settings tab lists it: the calendar's Provider and its kind. A read of its
 * own, so the calendar's Provider, which many of its tests build, stays as it is.
 */
export interface ClinicProvider extends Provider {
  kind: ProviderKind;
}

/** What Settings sets of a provider, new or changed. */
export interface ProviderFields {
  /** Trimmed here; not empty, at most PROVIDER_NAME_MAX characters. */
  name: string;
  /** Trimmed here; not empty, at most PROVIDER_SHORT_NAME_MAX characters. */
  shortName: string;
  kind: ProviderKind;
  /** Trimmed here; not empty, at most PROVIDER_CHAIR_MAX characters. */
  chairLabel: string;
  /** A whole number of degrees, 0 to PROVIDER_HUE_MAX. */
  colorHue: number;
}

/** Every provider of the clinic, active or not, with its kind, in the calendar's order. */
export async function clinicProviders(tx: TenantTransaction): Promise<ClinicProvider[]> {
  const rows = await tx
    .select({
      id: providers.id,
      name: providers.name,
      shortName: providers.shortName,
      kind: providers.kind,
      chairLabel: providers.chairLabel,
      colorHue: providers.colorHue,
      active: providers.active,
    })
    .from(providers)
    .orderBy(asc(providers.sortOrder), asc(providers.name), asc(providers.id));
  return rows.map((row) => ({ ...row, kind: providerKind(row.kind) }));
}

/**
 * Adds a provider to the clinic of this transaction, active, its texts trimmed, created and updated
 * at `now`, last in the calendar's order: its `sort_order` one above the clinic's highest, 0 for its
 * first. No lock (D-119): two adds at once may share a `sort_order`, which the calendar's order
 * breaks by name and id, and E01-T09c's move renumbers. A value the caller's schema should have
 * refused is an Error.
 */
export async function addProvider(
  tx: TenantTransaction,
  fields: ProviderFields,
  now: Date,
): Promise<{ id: string }> {
  const values = storableProvider(fields, 'addProvider');
  const [added] = await tx
    .insert(providers)
    .values({
      clinicId: sql`current_clinic_id()`,
      ...values,
      // Row-Level Security limits the subquery to the clinic's own providers.
      sortOrder: sql`(select coalesce(max(${providers.sortOrder}) + 1, 0) from ${providers})`,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: providers.id });
  if (!added) throw new Error('addProvider: the provider was not written');
  return { id: added.id };
}

/**
 * Why a provider was not changed: no provider of the clinic by that id (Row-Level Security shows no
 * other clinic's), or, for one whose kind is locked, a kind other than its own.
 */
export type ChangeProviderResult =
  { ok: true } | { ok: false; code: 'not_found' | 'provider_linked' };

/**
 * Sets a provider's name, short name, kind, chair and colour (the texts trimmed), and its
 * `updated_at` to `now`, active or not; whether it is active and its place in the order stay as they
 * are. `kindLocked` is the caller's word that a login is linked to the provider (auth's
 * linkedProviderIds, read in this transaction), whose kind an owner's aftercare approval follows
 * (D-051; owner, D-118): then a kind other than the stored one is refused as `provider_linked`, with
 * nothing written, and the stored one saves with the other fields. The row is locked while it is
 * read, so two changes at once are one after the other. The appointments booked with the provider
 * are not touched. A value the caller's schema should have refused is an Error.
 */
export async function changeProvider(
  tx: TenantTransaction,
  id: string,
  fields: ProviderFields,
  now: Date,
  { kindLocked }: { kindLocked: boolean },
): Promise<ChangeProviderResult> {
  const values = storableProvider(fields, 'changeProvider');
  const [stored] = await tx
    .select({ kind: providers.kind })
    .from(providers)
    .where(thisProvider(id))
    .for('update');
  if (!stored) return { ok: false, code: 'not_found' };
  if (kindLocked && stored.kind !== values.kind) return { ok: false, code: 'provider_linked' };
  await tx
    .update(providers)
    .set({ ...values, updatedAt: now })
    .where(thisProvider(id));
  return { ok: true };
}

/**
 * Why a provider was not made active or inactive: no provider of the clinic by that id; or one that
 * is so already (a second tab, or a press the list did not drop).
 */
export type SetProviderActiveRefusal = 'not_found' | 'already_active' | 'already_inactive';

export type SetProviderActiveResult = { ok: true } | { ok: false; code: SetProviderActiveRefusal };

/**
 * Makes a provider active or inactive, its `updated_at` then `now`. An inactive provider is offered to
 * no new booking (booking.ts: provider_not_bookable) and keeps every appointment, its visits ahead
 * still booked and on the calendar (owner, D-118); a login linked to it keeps its access, as nothing
 * of memberships changes here. The update holds only for a row in the other state, so of two presses
 * at once the second finds nothing to change and is refused: the state changes once.
 */
export async function setProviderActive(
  tx: TenantTransaction,
  id: string,
  active: boolean,
  now: Date,
): Promise<SetProviderActiveResult> {
  const changed = await tx
    .update(providers)
    .set({ active, updatedAt: now })
    .where(and(thisProvider(id), eq(providers.active, !active)))
    .returning({ id: providers.id });
  if (changed.length > 0) return { ok: true };
  const [stored] = await tx
    .select({ active: providers.active })
    .from(providers)
    .where(thisProvider(id));
  if (!stored) return { ok: false, code: 'not_found' };
  return { ok: false, code: active ? 'already_active' : 'already_inactive' };
}

/** Which way a provider moves in the clinic's order: towards the first column, or the last. */
export const PROVIDER_DIRECTIONS = ['up', 'down'] as const;

export type ProviderDirection = (typeof PROVIDER_DIRECTIONS)[number];

/**
 * Why a provider was not moved: no provider of the clinic by that id, or one with no neighbour that
 * way (the first cannot go up, the last cannot go down: a second tab, or a press the list did not
 * drop).
 */
export type MoveProviderRefusal = 'not_found' | 'already_first' | 'already_last';

export type MoveProviderResult = { ok: true } | { ok: false; code: MoveProviderRefusal };

/**
 * Moves a provider one place up or down the clinic's order (E01-T09c): swaps it with its neighbour in
 * the order the calendar reads (`sort_order`, name, id), inactive ones too, and writes `sort_order` =
 * the place (0, 1, 2 ...) of every provider whose value is another, `updated_at` `now`. So providers
 * that share a `sort_order` (two adds at once, D-119) are numbered apart by the first move, and the
 * clinic's places are 0 ... n-1, each once, afterwards.
 *
 * All the clinic's providers are locked first, in one statement ordered by `id`, so two moves at once
 * wait on each other in the same order and cannot deadlock, and the second reads the order the first
 * left. The order is read in a statement of its own after the locks, by the database's own ordering
 * (its collation sorts the names), as the calendar reads it. A provider added meanwhile is not locked
 * and keeps its value: it stays last, or ties, as D-119 allows.
 */
export async function moveProvider(
  tx: TenantTransaction,
  { providerId, direction }: { providerId: string; direction: ProviderDirection },
  now: Date,
): Promise<MoveProviderResult> {
  await tx.select({ id: providers.id }).from(providers).orderBy(asc(providers.id)).for('update');
  const order = await tx
    .select({ id: providers.id, sortOrder: providers.sortOrder })
    .from(providers)
    .orderBy(asc(providers.sortOrder), asc(providers.name), asc(providers.id));
  const at = order.findIndex((each) => each.id === providerId);
  if (at < 0) return { ok: false, code: 'not_found' };
  const to = direction === 'up' ? at - 1 : at + 1;
  if (to < 0) return { ok: false, code: 'already_first' };
  if (to >= order.length) return { ok: false, code: 'already_last' };
  const swapped = order.map((each) => each.id);
  [swapped[at], swapped[to]] = [swapped[to]!, swapped[at]!];
  for (const [place, id] of swapped.entries()) {
    if (order.find((each) => each.id === id)?.sortOrder === place) continue;
    await tx.update(providers).set({ sortOrder: place, updatedAt: now }).where(thisProvider(id));
  }
  return { ok: true };
}

/** The statuses of a visit that will not happen, or has: none of them is a visit ahead. */
const NOT_AHEAD = ['cancelled', 'no_show', 'completed'];

/**
 * How many of the provider's visits are ahead at `now`: not cancelled, no-show or completed, and
 * ending after `now`, so a visit under way counts, as lastAndNextVisits counts one (visits.ts). The
 * toast after a provider is made inactive says this many stay booked (owner, D-118).
 */
export async function visitsAhead(
  tx: TenantTransaction,
  providerId: string,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .select({ visits: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.providerId, providerId),
        notInArray(appointments.status, NOT_AHEAD),
        gt(appointments.endsAt, now),
      ),
    );
  return row?.visits ?? 0;
}

/** The provider of this id, in the clinic of this transaction: Row-Level Security's, named here too. */
function thisProvider(id: string) {
  return and(eq(providers.clinicId, sql`current_clinic_id()`), eq(providers.id, id));
}

/** A kind as the table holds it; the check allows no other, so another is an Error. */
function providerKind(kind: string): ProviderKind {
  const known = PROVIDER_KINDS.find((each) => each === kind);
  if (!known) throw new Error('clinicProviders: a provider has a kind the table does not allow');
  return known;
}

/**
 * The fields to store, the texts trimmed, when they can be stored; an Error when not: the caller's
 * schema refuses each first, at its field. The values are never in the error's message.
 */
function storableProvider(fields: ProviderFields, caller: string): ProviderFields {
  const name = fields.name.trim();
  const shortName = fields.shortName.trim();
  const chairLabel = fields.chairLabel.trim();
  if (
    name === '' ||
    name.length > PROVIDER_NAME_MAX ||
    shortName === '' ||
    shortName.length > PROVIDER_SHORT_NAME_MAX ||
    chairLabel === '' ||
    chairLabel.length > PROVIDER_CHAIR_MAX ||
    !PROVIDER_KINDS.includes(fields.kind) ||
    !Number.isInteger(fields.colorHue) ||
    fields.colorHue < 0 ||
    fields.colorHue > PROVIDER_HUE_MAX
  ) {
    throw new Error(`${caller}: the provider cannot be stored`);
  }
  return { name, shortName, kind: fields.kind, chairLabel, colorHue: fields.colorHue };
}
