/**
 * What the seed holds, written out in one place (E00-T05a): the fixed ids of the seeded clinics and
 * memberships, and the email each seeded person signs in with, so later seeds and tests can name
 * them. Every `pnpm db:reset` gives the same ones. A later seed adds its own ids here.
 *
 * A seeded person is named by email: the auth library gives each new person an id of its own
 * (createStaffUser(), D-063), so a person's id is new after every reset (handoffs/E00-T05a.md).
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

/** The seeded people, by the email they sign in with (README.md lists them by role). */
export const SEEDED_PEOPLE = {
  owner: { email: 'owner@example.test' },
  dentist: { email: 'dentist@example.test' },
  hygienist: { email: 'hygienist@example.test' },
  frontDesk: { email: 'front-desk@example.test' },
  /** The front desk with the `import` permission. */
  frontDeskImport: { email: 'front-desk-import@example.test' },
  /** The front desk of the second clinic only. */
  soncogledFrontDesk: { email: 'front-desk-soncogled@example.test' },
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
