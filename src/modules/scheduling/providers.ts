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
