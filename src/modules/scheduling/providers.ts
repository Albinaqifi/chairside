import { asc, eq, sql, type Column } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { providerBreaks, providers } from './schema';

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
 * The providers as Settings keeps them (E01-T09b): every provider of the clinic with its kind, and
 * one added. Changing one, and making one inactive or active again, is E01-T09d; the order and the
 * breaks E01-T09c. Never deleted (data-model.md: the app role has no DELETE on the table). A
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

/** What Settings sets of a new provider. */
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
  const values = storableProvider(fields);
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
function storableProvider(fields: ProviderFields): ProviderFields {
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
    throw new Error('addProvider: the provider cannot be stored');
  }
  return { name, shortName, kind: fields.kind, chairLabel, colorHue: fields.colorHue };
}
