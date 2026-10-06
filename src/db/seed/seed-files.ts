import type { ExtraPermission, Role } from '@/modules/auth';
import { clinicsAndStaff } from './01-clinics-and-staff';
import { scheduling } from './02-scheduling';
import type { CalendarDay } from './seed-day';

/**
 * Every seed file, in the order they run. Each schema task appends its own file, after the ones
 * before it, without changing them (E01-T01b's: providers, patients, a week of appointments). A
 * seed file is data: seedDatabase() (index.ts) writes exactly what it holds, and fake-data.test.ts
 * reads all of it against the fake-data rules.
 */
export const SEED_FILES: readonly SeedFile[] = [clinicsAndStaff, scheduling];

/** What one schema task adds to the seed. */
export interface SeedFile {
  /** What it adds, for the line the seed prints: "clinics and staff". */
  title: string;
  /** Rows written as they are, as the migration role, table by table in this order. */
  tables?: readonly SeedTable[];
  /**
   * Rows that depend on the seed's day, the seeded clinics' date (E01-T01b: a week of
   * appointments). Written after `tables`, in the same way. The same day gives the same rows, and
   * every day the same ids.
   */
  dayTables?: (day: CalendarDay) => readonly SeedTable[];
  /** People who sign in, made after the tables, each with their memberships. */
  people?: readonly SeedPerson[];
  /** Memberships linked to their provider, last: a link is set only where none is set. */
  providerLinks?: readonly SeedProviderLink[];
}

/** Rows of one table. A row whose id is in the table already is left as it is. */
export interface SeedTable {
  table: string;
  rows: readonly SeedRow[];
}

/** A row as it is written: its columns by their names in the database, an id among them. */
export type SeedRow = Readonly<{ id: string } & Record<string, SeedValue>>;

/** A column's value, sent as a query parameter. */
export type SeedValue = string | number | boolean | null | readonly string[];

/**
 * A person who signs in with the development password (seeded.ts). Made with createStaffUser()
 * (D-063) under their fixed id, unless a person with this id is there already.
 */
export interface SeedPerson {
  /** Their fixed id (seeded.ts), which createStaffUser() keeps. */
  id: string;
  email: string;
  name: string;
  memberships: readonly SeedMembership[];
}

/** A person's place in one clinic. */
export interface SeedMembership {
  id: string;
  clinicId: string;
  role: Role;
  extraPermissions: readonly ExtraPermission[];
}

/** A seeded membership and the provider of its clinic it is linked to: the person's column. */
export interface SeedProviderLink {
  membershipId: string;
  providerId: string;
}
