import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { membershipExtras, navigationFor } from '@/app/(staff)/navigation';
import { closeDb } from '@/db/client';
import { seedDatabase, type SeedSummary } from '@/db/seed';
import { isFakeEmail, isFakePhone } from '@/db/seed/fake-data';
import { SEED_PASSWORD, SEEDED_CLINICS, SEEDED_MEMBERSHIPS, SEEDED_PEOPLE } from '@/db/seed/seeded';
import messages from '@/i18n/en.json';
import { clinicsForUser, getAuth, type ExtraPermission, type Role } from '@/modules/auth';
import { migratorPool, ORIGIN, signInCookie } from './fixtures';
import { testDatabase } from './test-database';

// E00-T05a: the seed, written into the integration tests' database (acceptance 1, 2, 3 and 6). Its
// rows stay there for the test files that run after this one: they make their own clinics and
// people, and none counts rows across clinics. The expected logins are written out from the task's
// words, not read back from the seed file.

const HARBOUR_STREET = 'Harbour Street Dental';
const SONCOGLED = 'Забна клиника Сончоглед';

/** The sidebar of each role, as E00-T04b lists it (src/app/(staff)/navigation.test.ts). */
const FRONT_DESK = ['Today', 'Calendar', 'In the chair', 'Patients'];
const SIDEBAR = {
  owner: ['Today', 'Calendar', 'Patients', 'Automations', 'Import patients', 'Settings'],
  dentist: [...FRONT_DESK, 'Automations'],
  hygienist: FRONT_DESK,
  frontDesk: FRONT_DESK,
  frontDeskImport: [...FRONT_DESK, 'Import patients'],
};

interface Expected {
  clinicId: string;
  clinicName: string;
  role: Role;
  extraPermissions: ExtraPermission[];
  sidebar: string[];
}

const harbourStreet = (rest: Omit<Expected, 'clinicId' | 'clinicName'>): Expected => ({
  clinicId: SEEDED_CLINICS.harbourStreet,
  clinicName: HARBOUR_STREET,
  ...rest,
});
const soncogled = (rest: Omit<Expected, 'clinicId' | 'clinicName'>): Expected => ({
  clinicId: SEEDED_CLINICS.soncogled,
  clinicName: SONCOGLED,
  ...rest,
});

/** Each seeded login: its name (a role word), and its clinics in the order of their ids. */
const LOGINS = [
  {
    who: 'the owner',
    email: SEEDED_PEOPLE.owner.email,
    name: 'Owner',
    clinics: [
      harbourStreet({ role: 'owner', extraPermissions: [], sidebar: SIDEBAR.owner }),
      soncogled({ role: 'owner', extraPermissions: [], sidebar: SIDEBAR.owner }),
    ],
  },
  {
    who: 'the dentist',
    email: SEEDED_PEOPLE.dentist.email,
    name: 'Dentist',
    clinics: [harbourStreet({ role: 'dentist', extraPermissions: [], sidebar: SIDEBAR.dentist })],
  },
  {
    who: 'the hygienist',
    email: SEEDED_PEOPLE.hygienist.email,
    name: 'Hygienist',
    clinics: [
      harbourStreet({ role: 'hygienist', extraPermissions: [], sidebar: SIDEBAR.hygienist }),
    ],
  },
  {
    who: 'the front desk',
    email: SEEDED_PEOPLE.frontDesk.email,
    name: 'Front desk',
    clinics: [
      harbourStreet({ role: 'front_desk', extraPermissions: [], sidebar: SIDEBAR.frontDesk }),
    ],
  },
  {
    who: 'the front desk with the import permission',
    email: SEEDED_PEOPLE.frontDeskImport.email,
    name: 'Front desk',
    clinics: [
      harbourStreet({
        role: 'front_desk',
        extraPermissions: ['import'],
        sidebar: SIDEBAR.frontDeskImport,
      }),
    ],
  },
  {
    who: "the second clinic's front desk",
    email: SEEDED_PEOPLE.soncogledFrontDesk.email,
    name: 'Front desk',
    clinics: [soncogled({ role: 'front_desk', extraPermissions: [], sidebar: SIDEBAR.frontDesk })],
  },
];

const admin = migratorPool();
let firstRun: SeedSummary[];

let nextAddress = 1;
/** A client address no other test uses: the sign-in rate limit counts per address. */
const freshAddress = () => `10.37.0.${nextAddress++}`;

beforeAll(async () => {
  // Acceptance 6: the database the global setup built with resetDatabase() holds no seeded row.
  const { rows } = await admin.query('select id from clinics where id = any($1)', [
    Object.values(SEEDED_CLINICS),
  ]);
  expect(rows, 'resetDatabase() applies the migrations only').toEqual([]);

  firstRun = await seedDatabase(testDatabase());
}, 120_000);

afterAll(async () => {
  await closeDb();
  await admin.end();
});

/** The seed's rows as they are now, every column included. */
async function seededRows(): Promise<Record<string, unknown[]>> {
  const emails = Object.values(SEEDED_PEOPLE).map((person) => person.email);
  const query = async (sql: string, values: unknown[]) => (await admin.query(sql, values)).rows;
  return {
    clinics: await query('select * from clinics where id = any($1) order by id', [
      Object.values(SEEDED_CLINICS),
    ]),
    users: await query('select * from users where email = any($1) order by email', [emails]),
    accounts: await query(
      `select a.* from accounts a join users u on u.id = a.user_id
        where u.email = any($1) order by u.email`,
      [emails],
    ),
    memberships: await query('select * from memberships where id = any($1) order by id', [
      Object.values(SEEDED_MEMBERSHIPS),
    ]),
  };
}

describe('the seed (E00-T05a)', () => {
  it('adds two clinics, six people and seven memberships to a database without them', () => {
    expect(firstRun).toEqual([
      { title: 'clinics and staff', added: { clinics: 2, people: 6, memberships: 7 } },
    ]);
  });

  it('sets both clinics up for North Macedonia, with a phone from the block, an email and an address', async () => {
    const { rows } = await admin.query(
      `select id, name, timezone, locale, currency, default_country, phone, email, address, status
         from clinics where id = any($1) order by id`,
      [Object.values(SEEDED_CLINICS)],
    );
    expect(rows.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: SEEDED_CLINICS.harbourStreet, name: HARBOUR_STREET },
      { id: SEEDED_CLINICS.soncogled, name: SONCOGLED },
    ]);
    expect(SONCOGLED).toMatch(/^[\p{Script=Cyrillic} ]+$/u);
    for (const row of rows) {
      expect(row).toMatchObject({
        timezone: 'Europe/Skopje',
        locale: 'en',
        currency: 'MKD',
        default_country: 'MK',
        status: 'active',
      });
      expect(isFakePhone(row.phone as string), 'a phone from the block').toBe(true);
      expect(isFakeEmail(row.email as string), 'an email at example.test').toBe(true);
      expect(row.address, 'an address').toEqual(expect.any(String));
    }
  });

  it.each(LOGINS)(
    '$who signs in with the development password, and finds their clinics, role and sidebar',
    async ({ email, name, clinics }) => {
      const address = freshAddress();
      const cookie = await signInCookie(email, SEED_PASSWORD, address);
      const session = await getAuth().handler(
        new Request(`${ORIGIN}/api/auth/get-session`, {
          headers: { origin: ORIGIN, cookie, 'x-forwarded-for': address },
        }),
      );
      const { user } = (await session.json()) as { user: { id: string; name: string } };
      expect(user.name).toBe(name);

      const found = (await clinicsForUser(user.id)).sort((a, b) =>
        a.clinicId.localeCompare(b.clinicId),
      );
      expect(
        found.map((choice) => ({
          clinicId: choice.clinicId,
          clinicName: choice.clinicName,
          role: choice.role,
          extraPermissions: choice.extraPermissions,
          sidebar: navigationFor(choice.role, membershipExtras(choice)).map(
            (item) => messages.nav[item.key],
          ),
        })),
      ).toEqual(clinics);
    },
  );

  it('a second run adds nothing, changes nothing and ends without an error', async () => {
    const before = await seededRows();
    expect(before.users).toHaveLength(6);
    expect(before.accounts).toHaveLength(6);

    const secondRun = await seedDatabase(testDatabase());

    expect(secondRun).toEqual([
      { title: 'clinics and staff', added: { clinics: 0, people: 0, memberships: 0 } },
    ]);
    expect(await seededRows()).toEqual(before);
  });
});
