/**
 * What the seed holds, written out in one place (E00-T05a): the fixed ids of the seeded clinics,
 * people and memberships, and the email each seeded person signs in with, so later seeds and tests
 * can name them. Every `pnpm db:reset` gives the same ones. A later seed adds its own ids here:
 * E01-T01b its providers, and seededId() for the tables with many rows.
 *
 * A person's id is given to createStaffUser(), which only the seed does (owner,
 * handoffs/E00-T05a.md). Their password row is the auth library's: its own id is new after every
 * reset, as its hash is.
 *
 * The ids are UUID v7 in form, and all share `5eed` in their second group, so a seeded row is
 * recognisable at a glance.
 */

/** The development password of every seeded login, written in README.md. */
export const SEED_PASSWORD = 'local-staff-password';

/** The seeded clinics, by id. */
export const SEEDED_CLINICS = {
  /** Harbour Street Dental: every role has a login here. */
  harbourStreet: '019a0000-5eed-7000-8000-000000000101',
  /** The second clinic, named in Cyrillic: the owner, and a front desk who is only here. */
  soncogled: '019a0000-5eed-7000-8000-000000000102',
} as const;

/** The seeded people: their ids, and the email each signs in with (README.md lists them by role). */
export const SEEDED_PEOPLE = {
  owner: { id: '019a0000-5eed-7000-8000-000000000201', email: 'owner@example.test' },
  dentist: { id: '019a0000-5eed-7000-8000-000000000202', email: 'dentist@example.test' },
  hygienist: { id: '019a0000-5eed-7000-8000-000000000203', email: 'hygienist@example.test' },
  frontDesk: { id: '019a0000-5eed-7000-8000-000000000204', email: 'front-desk@example.test' },
  /** The front desk with the `import` permission. */
  frontDeskImport: {
    id: '019a0000-5eed-7000-8000-000000000205',
    email: 'front-desk-import@example.test',
  },
  /** The front desk of the second clinic only. */
  soncogledFrontDesk: {
    id: '019a0000-5eed-7000-8000-000000000206',
    email: 'front-desk-soncogled@example.test',
  },
} as const;

/** The seeded memberships, by id: who may enter which clinic, and as what. */
export const SEEDED_MEMBERSHIPS = {
  harbourStreetOwner: '019a0000-5eed-7000-8000-000000000301',
  harbourStreetDentist: '019a0000-5eed-7000-8000-000000000302',
  harbourStreetHygienist: '019a0000-5eed-7000-8000-000000000303',
  harbourStreetFrontDesk: '019a0000-5eed-7000-8000-000000000304',
  harbourStreetFrontDeskImport: '019a0000-5eed-7000-8000-000000000305',
  soncogledOwner: '019a0000-5eed-7000-8000-000000000306',
  soncogledFrontDesk: '019a0000-5eed-7000-8000-000000000307',
} as const;

/*
 * E01-T01b: the scheduling seed (02-scheduling.ts).
 */

/** The time zone of both seeded clinics (D-049): the seed's day is the day it is there. */
export const SEEDED_TIME_ZONE = 'Europe/Skopje';

/** The seeded providers, by id: the calendar's columns. */
export const SEEDED_PROVIDERS = {
  /** Harbour Street's first dentist, Chair 1: the seeded dentist's column. */
  harbourStreetDentist: '019a0000-5eed-7000-8000-000000000401',
  /** Its second dentist, Chair 2: nobody signs in as them. */
  harbourStreetSecondDentist: '019a0000-5eed-7000-8000-000000000402',
  /** Its hygienist, Chair 3: the seeded hygienist's column. */
  harbourStreetHygienist: '019a0000-5eed-7000-8000-000000000403',
  /** The second clinic's one dentist: nobody signs in as them. */
  soncogledDentist: '019a0000-5eed-7000-8000-000000000404',
} as const;

/**
 * Where the ids of the tables with many seeded rows start: the n-th row's id ends in `from + n`.
 * Each table has a block of its own, after E00-T05a's (1xx clinics, 2xx people, 3xx memberships)
 * and the providers' (4xx), so no two rows share an id: `on conflict (id) do nothing` would drop
 * the second without a word.
 */
const ID_BLOCKS = {
  provider_breaks: { from: 500, size: 100 },
  treatment_types: { from: 600, size: 100 },
  clinic_hours: { from: 700, size: 100 },
  closed_days: { from: 800, size: 100 },
  patients: { from: 1000, size: 1000 },
  appointments: { from: 2000, size: 1000 },
} as const;

/** A table whose seeded rows take their ids from seededId(). */
export type SeededIdTable = keyof typeof ID_BLOCKS;

/** The fixed id of the table's n-th seeded row, n from 1: appointment 1 is `…-000000002001`. */
export function seededId(table: SeededIdTable, n: number): string {
  const { from, size } = ID_BLOCKS[table];
  if (!Number.isInteger(n) || n < 1 || n >= size) {
    throw new RangeError(`seededId: ${table} takes n from 1 to ${size - 1}`);
  }
  return `019a0000-5eed-7000-8000-${String(from + n).padStart(12, '0')}`;
}
