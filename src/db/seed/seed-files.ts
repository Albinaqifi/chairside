import type { ExtraPermission, Role } from '@/modules/auth';
import { clinicsAndStaff } from './01-clinics-and-staff';

/**
 * Every seed file, in the order they run. Each schema task appends its own file, after the ones
 * before it, without changing them (E01-T01 next: providers, patients, appointments). A seed file
 * is data: seedDatabase() (index.ts) writes exactly what it holds, and fake-data.test.ts reads all
 * of it against the fake-data rules.
 */
export const SEED_FILES: readonly SeedFile[] = [clinicsAndStaff];

/** What one schema task adds to the seed. */
export interface SeedFile {
  /** What it adds, for the line the seed prints: "clinics and staff". */
  title: string;
  /** Rows written as they are, as the migration role, table by table in this order. */
  tables?: readonly SeedTable[];
  /** People who sign in, made after the tables, each with their memberships. */
  people?: readonly SeedPerson[];
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
 * (D-063) unless a person with this email is there already.
 */
export interface SeedPerson {
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
