import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClock } from '@/lib/clock';
import { describeSummary, seedDatabase, seedDayOf, type SeedUrls } from './index';

// E00-T05a, acceptance 5: the seed refuses what db:reset refuses, before it connects. Its logins
// share a password written in README.md, so it must never reach a database that is not on this
// machine. Every connection is caught here: none may start. The URLs are made up; `.invalid` host
// names never resolve (RFC 2606).

const LOCAL: SeedUrls = {
  migratorUrl: 'postgres://guard_migrator:pw@127.0.0.1:5433/guard_db',
  appUrl: 'postgres://chairside_app:pw@127.0.0.1:5433/guard_db',
};
const URL_NAMES = ['migratorUrl', 'appUrl'] as const;

/** Every way the seed could connect: its own client, and the pool createStaffUser() uses. */
let connections: { mock: { calls: unknown[] } }[];

beforeEach(() => {
  // DATABASE_URL is what createStaffUser() connects with: the same database as appUrl.
  vi.stubEnv('DATABASE_URL', LOCAL.appUrl);
  connections = [
    vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(() => {
      throw new Error('the seed connected');
    }),
    vi.spyOn(pg.Pool.prototype, 'connect').mockImplementation(() => {
      throw new Error('the seed connected');
    }),
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Expects the seed to refuse with this message and never to have tried to connect. */
async function expectRefusedBeforeConnecting(urls: SeedUrls, message: string): Promise<void> {
  await expect(seedDatabase(urls)).rejects.toThrow(message);
  for (const connection of connections) expect(connection.mock.calls).toEqual([]);
}

describe('the db:seed guard, before it connects', () => {
  it.each(URL_NAMES)('refuses a host that is not this machine in %s', async (name) => {
    const urls = { ...LOCAL, [name]: LOCAL[name].replace('127.0.0.1', 'db.example.invalid') };
    await expectRefusedBeforeConnecting(
      urls,
      'Refusing to seed a database on "db.example.invalid": only local ones.',
    );
  });

  it.each(URL_NAMES)(
    'refuses a host given in the query string of %s, which pg uses',
    async (name) => {
      const urls = { ...LOCAL, [name]: `${LOCAL[name]}?host=db.example.invalid` };
      await expectRefusedBeforeConnecting(
        urls,
        'Refusing to seed a database on "db.example.invalid"',
      );
    },
  );

  it('refuses when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expectRefusedBeforeConnecting(
      LOCAL,
      'Refusing to seed a database when NODE_ENV is production.',
    );
  });

  it('refuses another server on this machine', async () => {
    const urls = { ...LOCAL, migratorUrl: LOCAL.migratorUrl.replace(':5433', ':5432') };
    await expectRefusedBeforeConnecting(
      urls,
      'Refusing to seed: MIGRATION_DATABASE_URL and DATABASE_URL must name the same host and port ' +
        '(they name 127.0.0.1:5432, 127.0.0.1:5433).',
    );
  });

  it('refuses migration and app connections to two databases, and an app role other than chairside_app', async () => {
    await expectRefusedBeforeConnecting(
      { ...LOCAL, appUrl: LOCAL.appUrl.replace('/guard_db', '/other_db') },
      'MIGRATION_DATABASE_URL and DATABASE_URL must name the same database.',
    );
    await expectRefusedBeforeConnecting(
      { ...LOCAL, appUrl: LOCAL.appUrl.replace('chairside_app', 'postgres') },
      'DATABASE_URL must connect as chairside_app',
    );
  });

  it.each([
    {
      what: 'a host that is not this machine',
      url: 'postgres://chairside_app:pw@db.example.invalid:5433/guard_db',
    },
    { what: 'another database', url: 'postgres://chairside_app:pw@127.0.0.1:5433/other_db' },
    { what: 'another port', url: 'postgres://chairside_app:pw@127.0.0.1:5432/guard_db' },
    { what: 'another role', url: 'postgres://postgres:pw@127.0.0.1:5433/guard_db' },
  ])(
    'refuses when DATABASE_URL, which createStaffUser() makes the people through, names $what',
    async ({ url }) => {
      vi.stubEnv('DATABASE_URL', url);
      await expectRefusedBeforeConnecting(
        LOCAL,
        'Refusing to seed: DATABASE_URL must name the database being seeded',
      );
    },
  );

  it('refuses without DATABASE_URL', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expectRefusedBeforeConnecting(LOCAL, 'DATABASE_URL is not set.');
  });

  it('lets a database on this machine through: the seed then connects as the migration role', async () => {
    await expect(seedDatabase(LOCAL)).rejects.toThrow('the seed connected');
    expect(connections[0]!.mock.calls).toHaveLength(1);
  });
});

describe("the seed's day (E01-T01b)", () => {
  it('is the day given, or the date it is in the seeded clinics when the clock is read', () => {
    expect(seedDayOf('2026-10-28')).toBe('2026-10-28');
    // 23:30 UTC on 25 October is already the 26th in Skopje, and 12:30 on the 26th in Auckland.
    expect(seedDayOf(undefined, fakeClock('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
    expect(seedDayOf(undefined, fakeClock('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
  });

  it('refuses a day that is not a date of the calendar, before the seed connects', async () => {
    for (const day of ['2026-02-30', '28.10.2026', '']) {
      expect(() => seedDayOf(day), day).toThrow(RangeError);
      await expect(seedDatabase(LOCAL, day), day).rejects.toThrow(
        'day must be a date of the calendar',
      );
    }
    for (const connection of connections) expect(connection.mock.calls).toEqual([]);
  });
});

describe('the line the seed prints', () => {
  it('counts what a file added, and says when it was there already', () => {
    expect(
      describeSummary({
        title: 'clinics and staff',
        added: { clinics: 2, people: 6, memberships: 0 },
      }),
    ).toBe('Seed "clinics and staff": added 2 clinics, 6 people.');
    expect(
      describeSummary({
        title: 'clinics and staff',
        added: { clinics: 0, people: 0, memberships: 0 },
      }),
    ).toBe('Seed "clinics and staff": there already, nothing added.');
  });
});
