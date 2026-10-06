/**
 * What the seed holds, written out in one place (E00-T05a): the fixed ids of the seeded clinics,
 * people and memberships, and the email each seeded person signs in with, so later seeds and tests
 * can name them. Every `pnpm db:reset` gives the same ones. A later seed adds its own ids here.
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
