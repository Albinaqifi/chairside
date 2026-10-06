import { fakePhone } from './fake-data';
import type { SeedFile } from './seed-files';
import { SEEDED_CLINICS, SEEDED_MEMBERSHIPS, SEEDED_PEOPLE } from './seeded';

/** Every seeded clinic is set up for North Macedonia (D-049), its texts in English (D-053). */
const NORTH_MACEDONIA = {
  timezone: 'Europe/Skopje',
  locale: 'en',
  currency: 'MKD',
  default_country: 'MK',
} as const;

/**
 * The first seed file (E00-T05a): two clinics, and a login for every role. Harbour Street Dental
 * has one person per role, and a second front desk with the `import` permission; the second
 * clinic, named in Cyrillic, has the owner (so they see Switch clinic) and a front desk who is
 * there only. Every person's name is a role word.
 */
export const clinicsAndStaff: SeedFile = {
  title: 'clinics and staff',
  tables: [
    {
      table: 'clinics',
      rows: [
        {
          id: SEEDED_CLINICS.harbourStreet,
          name: 'Harbour Street Dental',
          ...NORTH_MACEDONIA,
          phone: fakePhone(1),
          email: 'harbour-street@example.test',
          address: '12 Harbour Street, 1000 Skopje',
        },
        {
          id: SEEDED_CLINICS.soncogled,
          name: 'Забна клиника Сончоглед',
          ...NORTH_MACEDONIA,
          phone: fakePhone(2),
          email: 'soncogled@example.test',
          address: 'ул. Сончогледова 7, 6000 Охрид',
        },
      ],
    },
  ],
  people: [
    {
      email: SEEDED_PEOPLE.owner.email,
      name: 'Owner',
      memberships: [
        {
          id: SEEDED_MEMBERSHIPS.harbourStreetOwner,
          clinicId: SEEDED_CLINICS.harbourStreet,
          role: 'owner',
          extraPermissions: [],
        },
        {
          id: SEEDED_MEMBERSHIPS.soncogledOwner,
          clinicId: SEEDED_CLINICS.soncogled,
          role: 'owner',
          extraPermissions: [],
        },
      ],
    },
    {
      email: SEEDED_PEOPLE.dentist.email,
      name: 'Dentist',
      memberships: [
        {
          id: SEEDED_MEMBERSHIPS.harbourStreetDentist,
          clinicId: SEEDED_CLINICS.harbourStreet,
          role: 'dentist',
          extraPermissions: [],
        },
      ],
    },
    {
      email: SEEDED_PEOPLE.hygienist.email,
      name: 'Hygienist',
      memberships: [
        {
          id: SEEDED_MEMBERSHIPS.harbourStreetHygienist,
          clinicId: SEEDED_CLINICS.harbourStreet,
          role: 'hygienist',
          extraPermissions: [],
        },
      ],
    },
    {
      email: SEEDED_PEOPLE.frontDesk.email,
      name: 'Front desk',
      memberships: [
        {
          id: SEEDED_MEMBERSHIPS.harbourStreetFrontDesk,
          clinicId: SEEDED_CLINICS.harbourStreet,
          role: 'front_desk',
          extraPermissions: [],
        },
      ],
    },
    {
      email: SEEDED_PEOPLE.frontDeskImport.email,
      name: 'Front desk',
      memberships: [
        {
          id: SEEDED_MEMBERSHIPS.harbourStreetFrontDeskImport,
          clinicId: SEEDED_CLINICS.harbourStreet,
          role: 'front_desk',
          extraPermissions: ['import'],
        },
      ],
    },
    {
      email: SEEDED_PEOPLE.soncogledFrontDesk.email,
      name: 'Front desk',
      memberships: [
        {
          id: SEEDED_MEMBERSHIPS.soncogledFrontDesk,
          clinicId: SEEDED_CLINICS.soncogled,
          role: 'front_desk',
          extraPermissions: [],
        },
      ],
    },
  ],
};
