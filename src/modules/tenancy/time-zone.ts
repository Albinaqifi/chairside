import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';

/*
 * A clinic's time zone (E01-T08a, D-110): a name both PostgreSQL and Intl know, so a moment means the
 * same in SQL (`AT TIME ZONE`) and on the page. One of PostgreSQL's region names (`Area/Location`,
 * none under `Etc/`) or UTC, stored as PostgreSQL spells it. Never an offset: a clinic saved with
 * `+01:00` would never move to summer time, and PostgreSQL reads that text as an hour west of UTC
 * where Intl reads it an hour east. Nor a fixed zone such as `Etc/GMT-1`, for the same summer.
 *
 * Intl's own list is not the source: it lacks UTC and Europe/Kyiv, and spells 18 zones the old way
 * (Europe/Kiev, Asia/Calcutta), which the database does not know. Intl takes the new names all the
 * same, and every region name of the `postgres:18` image (447 of them) is one Intl knows.
 */

/**
 * True when a clinic may have the zone by this name, as far as the name and Intl tell: a region's
 * name or UTC, in any case, that Intl knows (`europe/skopje` is Europe/Skopje to both). An offset
 * such as `+01:00`, which Intl reads as one, is no region's name, and neither is an `Etc/` zone.
 * The check that needs no database: `pnpm clinic:create` makes it before it connects (through
 * newClinicProblems()), and the Settings form's schema at its field. Whether the database knows the
 * name is knownTimeZone()'s.
 */
export function isClinicTimeZoneName(name: string): boolean {
  const lower = name.toLowerCase();
  const region = lower.includes('/') && !lower.startsWith('etc/');
  return (region || lower === 'utc') && intlKnows(name);
}

function intlKnows(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone by this name as PostgreSQL spells it (`europe/skopje` → `Europe/Skopje`), or null when no
 * clinic may have it: isClinicTimeZoneName() refuses it, or the database does not know it
 * (`pg_timezone_names`, which every role may read; `Europe/Kiev` is not there). The one check for the
 * Settings save and for `pnpm clinic:create`, inside the transaction that writes the zone.
 */
export async function knownTimeZone(tx: TenantTransaction, name: string): Promise<string | null> {
  if (!isClinicTimeZoneName(name)) return null;
  const { rows } = await tx.execute(
    sql`select name from pg_timezone_names where lower(name) = lower(${name})`,
  );
  return zoneNames(rows).find(isClinicTimeZoneName) ?? null;
}

/**
 * Every zone a clinic may have, as PostgreSQL spells it, in the order of their names: what the
 * Settings form offers.
 */
export async function clinicTimeZones(tx: TenantTransaction): Promise<string[]> {
  const { rows } = await tx.execute(sql`select name from pg_timezone_names`);
  return zoneNames(rows)
    .filter(isClinicTimeZoneName)
    .sort((a, b) => (a < b ? -1 : 1));
}

function zoneNames(rows: Record<string, unknown>[]): string[] {
  return rows.map((row) => String(row.name));
}
