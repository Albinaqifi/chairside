import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firstChoice, shownColumns } from '@/app/(staff)/calendar/filter';
import { ownProvider, readDay } from '@/app/(staff)/calendar/read-day';
import { membershipExtras, navigationFor } from '@/app/(staff)/navigation';
import { closeDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { seedDatabase, seedDayOf, type SeedSummary } from '@/db/seed';
import { scheduling } from '@/db/seed/02-scheduling';
import { isFakeEmail, isFakePhone } from '@/db/seed/fake-data';
import { seedWeek } from '@/db/seed/seed-day';
import { addDays, isoWeekday } from '@/lib/calendar-day';
import {
  SEED_PASSWORD,
  SEEDED_CLINICS,
  SEEDED_MEMBERSHIPS,
  SEEDED_PEOPLE,
  SEEDED_PROVIDERS,
  SEEDED_TIME_ZONE,
} from '@/db/seed/seeded';
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
    id: SEEDED_PEOPLE.owner.id,
    email: SEEDED_PEOPLE.owner.email,
    name: 'Owner',
    clinics: [
      harbourStreet({ role: 'owner', extraPermissions: [], sidebar: SIDEBAR.owner }),
      soncogled({ role: 'owner', extraPermissions: [], sidebar: SIDEBAR.owner }),
    ],
  },
  {
    who: 'the dentist',
    id: SEEDED_PEOPLE.dentist.id,
    email: SEEDED_PEOPLE.dentist.email,
    name: 'Dentist',
    clinics: [harbourStreet({ role: 'dentist', extraPermissions: [], sidebar: SIDEBAR.dentist })],
  },
  {
    who: 'the hygienist',
    id: SEEDED_PEOPLE.hygienist.id,
    email: SEEDED_PEOPLE.hygienist.email,
    name: 'Hygienist',
    clinics: [
      harbourStreet({ role: 'hygienist', extraPermissions: [], sidebar: SIDEBAR.hygienist }),
    ],
  },
  {
    who: 'the front desk',
    id: SEEDED_PEOPLE.frontDesk.id,
    email: SEEDED_PEOPLE.frontDesk.email,
    name: 'Front desk',
    clinics: [
      harbourStreet({ role: 'front_desk', extraPermissions: [], sidebar: SIDEBAR.frontDesk }),
    ],
  },
  {
    who: 'the front desk with the import permission',
    id: SEEDED_PEOPLE.frontDeskImport.id,
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
    id: SEEDED_PEOPLE.soncogledFrontDesk.id,
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
      {
        title: 'scheduling',
        added: {
          providers: 4,
          provider_breaks: 15,
          treatment_types: 10,
          clinic_hours: 10,
          patients: 45,
          closed_days: 1,
          appointments: 86,
          'provider links': 2,
        },
      },
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
    async ({ id, email, name, clinics }) => {
      const address = freshAddress();
      const cookie = await signInCookie(email, SEED_PASSWORD, address);
      const session = await getAuth().handler(
        new Request(`${ORIGIN}/api/auth/get-session`, {
          headers: { origin: ORIGIN, cookie, 'x-forwarded-for': address },
        }),
      );
      const { user } = (await session.json()) as { user: { id: string; name: string } };
      expect(user.name).toBe(name);
      expect(user.id, 'their fixed id, the same after every reset').toBe(id);

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
      {
        title: 'scheduling',
        added: {
          providers: 0,
          provider_breaks: 0,
          treatment_types: 0,
          clinic_hours: 0,
          patients: 0,
          closed_days: 0,
          appointments: 0,
          'provider links': 0,
        },
      },
    ]);
    expect(await seededRows()).toEqual(before);
  });
});

// E01-T01b, acceptance 3: the scheduling seed file, written by the one seeding above (beforeAll),
// with the real day. Its ids are the same whatever the day (seeded.test.ts), so its rows are found
// by the ids it gives for any day; the statuses, which depend on the day, are checked by the unit
// tests (src/db/seed/02-scheduling.test.ts), never here.
describe('the scheduling seed (E01-T01b)', () => {
  const tables = [...(scheduling.tables ?? []), ...(scheduling.dayTables?.('2026-10-19') ?? [])];
  const appointments = tables.find(({ table }) => table === 'appointments')?.rows ?? [];

  it('writes every row of its file, none refused and none dropped', async () => {
    const added = firstRun.find(({ title }) => title === 'scheduling')?.added;
    for (const { table, rows } of tables) {
      const ids = rows.map((row) => row.id).sort();
      const found = await admin.query<{ id: string }>(
        `select id from ${table} where id = any($1)`,
        [ids],
      );
      expect(found.rows.map((row) => row.id).sort(), table).toEqual(ids);
      expect(added?.[table], `${table}: the first run's count`).toBe(rows.length);
    }
  });

  it('links the seeded dentist and hygienist to their providers, and nobody else', async () => {
    const { rows } = await admin.query<{ id: string; provider_id: string | null }>(
      'select id, provider_id from memberships where id = any($1)',
      [Object.values(SEEDED_MEMBERSHIPS)],
    );
    const linked = Object.fromEntries(rows.map((row) => [row.id, row.provider_id]));
    expect(linked).toEqual({
      ...Object.fromEntries(Object.values(SEEDED_MEMBERSHIPS).map((id) => [id, null])),
      [SEEDED_MEMBERSHIPS.harbourStreetDentist]: SEEDED_PROVIDERS.harbourStreetDentist,
      [SEEDED_MEMBERSHIPS.harbourStreetHygienist]: SEEDED_PROVIDERS.harbourStreetHygienist,
    });
  });

  const { harbourStreet, soncogled: secondClinic } = SEEDED_CLINICS;
  it.each([
    { who: 'the dentist', id: SEEDED_PEOPLE.dentist.id, kinds: { [harbourStreet]: 'dentist' } },
    {
      who: 'the hygienist',
      id: SEEDED_PEOPLE.hygienist.id,
      kinds: { [harbourStreet]: 'hygienist' },
    },
    {
      who: 'the owner',
      id: SEEDED_PEOPLE.owner.id,
      kinds: { [harbourStreet]: null, [secondClinic]: null },
    },
  ])(
    "clinics_for_user() gives $who their provider's kind in each clinic, or none",
    async (seeded) => {
      const found = await clinicsForUser(seeded.id);
      expect(
        Object.fromEntries(found.map((choice) => [choice.clinicId, choice.providerKind])),
      ).toEqual(seeded.kinds);
    },
  );

  it("stores each appointment at the weekday and local time its file wrote, in the clinics' zone", async () => {
    // The file writes `2026-10-19 08:00 Europe/Skopje`; PostgreSQL turns it into the moment.
    const weekdayAndTime = (moment: unknown) => {
      const [day = '', time] = String(moment).split(' ');
      return `${isoWeekday(day)} ${time}`;
    };
    const { rows } = await admin.query<{ id: string; starts: string; ends: string }>(
      `select id,
              to_char(starts_at at time zone $2, 'ID HH24:MI') as starts,
              to_char(ends_at at time zone $2, 'ID HH24:MI') as ends
         from appointments where id = any($1)`,
      [appointments.map((row) => row.id), SEEDED_TIME_ZONE],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, [row.starts, row.ends]]))).toEqual(
      Object.fromEntries(
        appointments.map((row) => [
          row.id,
          [weekdayAndTime(row.starts_at), weekdayAndTime(row.ends_at)],
        ]),
      ),
    );
  });

  it('fills the week of the day the seed ran on, read from the clock', async () => {
    const { rows } = await admin.query<{ day: string }>(
      `select distinct to_char(starts_at at time zone $2, 'YYYY-MM-DD') as day
         from appointments where id = any($1) order by 1`,
      [appointments.map((row) => row.id), SEEDED_TIME_ZONE],
    );
    // The seed ran in beforeAll: today, or yesterday if midnight has passed since.
    const today = seedDayOf(undefined);
    const weeks = [seedWeek(today), seedWeek(addDays(today, -1))];
    expect(weeks).toContainEqual(rows.map((row) => row.day));
  });
});

// E01-T04b, acceptance 2: the calendar's read as each seeded login of Harbour Street, in the clinic's
// own transaction, as the read's handler runs it (src/app/(staff)/calendar/actions.ts): the seeded
// dentist and hygienist open on their own columns, the owner and the front desks on all three. The
// day is any weekday: the three seeded providers are active, so each has a column every day. The
// read through the page and as the browser calls it: tests/integration/calendar-own-column.test.ts.
describe('the calendar each seeded login of Harbour Street opens on (E01-T04b)', () => {
  const { harbourStreetDentist, harbourStreetSecondDentist, harbourStreetHygienist } =
    SEEDED_PROVIDERS;
  const ALL = [harbourStreetDentist, harbourStreetSecondDentist, harbourStreetHygienist];

  it.each([
    { who: 'the dentist', id: SEEDED_PEOPLE.dentist.id, opensOn: [harbourStreetDentist] },
    { who: 'the hygienist', id: SEEDED_PEOPLE.hygienist.id, opensOn: [harbourStreetHygienist] },
    { who: 'the owner', id: SEEDED_PEOPLE.owner.id, opensOn: ALL },
    { who: 'the front desk', id: SEEDED_PEOPLE.frontDesk.id, opensOn: ALL },
    { who: 'the front desk with import', id: SEEDED_PEOPLE.frontDeskImport.id, opensOn: ALL },
  ])('$who', async ({ id, opensOn }) => {
    const read = await withTenant(SEEDED_CLINICS.harbourStreet, async (tx) => ({
      view: await readDay(tx, '2026-10-26', new Date('2026-10-26T09:00:00Z')),
      ownProviderId: await ownProvider(tx, id),
    }));
    expect(read.view.columns.map((column) => column.providerId)).toEqual(ALL);
    const columns = read.view.columns.map((column) => column.providerId);
    expect(shownColumns(firstChoice(read.ownProviderId), columns)).toEqual(opensOn);
  });
});
