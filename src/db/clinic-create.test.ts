import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';
import { CLINIC_DEFAULTS, parseClinicCreateArgs, runClinicCreate, USAGE } from './clinic-create';

// E00-T05b, acceptance 6 and 7: what `pnpm clinic:create` refuses before it connects, so before
// anything is written. Every connection is caught here, the one the auth library opens through the
// app's pool included: none may start. The URLs are made up; `.invalid` host names never resolve
// (RFC 2606). The email is synthetic (example.test).

const LOCAL_APP_URL = 'postgres://chairside_app:pw@127.0.0.1:5433/guard_db';
const REMOTE_APP_URL = 'postgres://chairside_app:pw@db.example.invalid:5432/chairside';

/** A command line that passes every check. */
const VALID = [
  '--name',
  'Lakeside Dental',
  '--owner-email',
  'lakeside-owner@example.test',
  '--owner-name',
  'Owner',
];

/** The same, with one option's value replaced, or the option left out when `value` is undefined. */
function withOption(option: string, value: string | undefined): string[] {
  const args = [...VALID];
  const at = args.indexOf(option);
  if (at === -1) return value === undefined ? args : [...args, option, value];
  if (value === undefined) args.splice(at, 2);
  else args[at + 1] = value;
  return args;
}

let connections: { mock: { calls: unknown[] } }[];
let written: string[];

beforeEach(() => {
  vi.stubEnv('DATABASE_URL', LOCAL_APP_URL);
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-secret-guard-3f9a1c7e5b2d4f6a8c0e1b3d');
  connections = [
    vi.spyOn(pg.Client.prototype, 'connect').mockImplementation(() => {
      throw new Error('the script connected');
    }),
    vi.spyOn(pg.Pool.prototype, 'connect').mockImplementation(() => {
      throw new Error('the script connected');
    }),
  ];
  written = [];
  const keep = (...args: unknown[]) => void written.push(args.map(String).join(' '));
  vi.spyOn(console, 'log').mockImplementation(keep);
  vi.spyOn(console, 'error').mockImplementation(keep);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeDb();
});

/**
 * True when the run failed because it tried to connect: the stand-in's error, as the auth library's
 * adapter wraps it (a failed query, its cause the connection's error).
 */
async function connectionRefusedIn(run: Promise<number>): Promise<boolean> {
  let error = await run.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  for (let depth = 0; error instanceof Error && depth < 5; depth++) {
    if (error.message === 'the script connected') return true;
    error = error.cause;
  }
  return false;
}

/** Expects the run to refuse, saying `message`, and never to have tried to connect. */
async function expectRefusedBeforeConnecting(argv: string[], message: string): Promise<void> {
  expect(await runClinicCreate(argv)).toBe(1);
  expect(written.join('\n')).toContain(message);
  for (const connection of connections) expect(connection.mock.calls).toEqual([]);
}

describe('the command line', () => {
  it("gives North Macedonia's settings where none is given; the names trimmed, the email lower-cased", () => {
    expect(
      parseClinicCreateArgs([
        '--name',
        ' Lakeside Dental ',
        '--owner-email',
        ' Lakeside-Owner@Example.TEST ',
        '--owner-name',
        ' Owner ',
      ]),
    ).toEqual({
      kind: 'create',
      input: {
        name: 'Lakeside Dental',
        ownerEmail: 'lakeside-owner@example.test',
        ownerName: 'Owner',
        timeZone: 'Europe/Skopje',
        country: 'MK',
        currency: 'MKD',
        locale: 'en',
      },
      remoteDatabase: false,
    });
    expect(CLINIC_DEFAULTS).toEqual({
      timeZone: 'Europe/Skopje',
      country: 'MK',
      currency: 'MKD',
      locale: 'en',
    });
  });

  it('takes every setting it is given, and --remote-database; a `--` in front changes nothing', () => {
    const argv = [
      ...VALID,
      '--time-zone',
      'Europe/London',
      '--country',
      'GB',
      '--currency',
      'GBP',
      '--locale',
      'en',
      '--remote-database',
    ];
    const expected = {
      kind: 'create',
      input: {
        name: 'Lakeside Dental',
        ownerEmail: 'lakeside-owner@example.test',
        ownerName: 'Owner',
        timeZone: 'Europe/London',
        country: 'GB',
        currency: 'GBP',
        locale: 'en',
      },
      remoteDatabase: true,
    };
    expect(parseClinicCreateArgs(argv)).toEqual(expected);
    expect(parseClinicCreateArgs(['--', ...argv])).toEqual(expected);
  });

  it('--help prints how to use it, and connects nowhere', async () => {
    expect(await runClinicCreate(['--help'])).toBe(0);
    expect(written).toEqual([USAGE]);
    for (const connection of connections) expect(connection.mock.calls).toEqual([]);
  });
});

describe('refused before it connects, each with a message naming the option (acceptance 7)', () => {
  it.each([
    {
      what: 'a time zone Intl does not know',
      argv: withOption('--time-zone', 'Europe/Skopie'),
      option: '--time-zone',
      typed: 'Skopie',
    },
    {
      what: 'a country the phone package does not support',
      argv: withOption('--country', 'UK'),
      option: '--country',
      typed: 'UK,',
    },
    {
      what: 'a country in lower case',
      argv: withOption('--country', 'mk'),
      option: '--country',
      typed: 'mk',
    },
    {
      what: 'a malformed email',
      argv: withOption('--owner-email', 'lakeside-owner.example.test'),
      option: '--owner-email',
      typed: 'lakeside-owner',
    },
    {
      what: 'no owner email',
      argv: withOption('--owner-email', undefined),
      option: '--owner-email',
      typed: 'lakeside-owner',
    },
    {
      what: 'a currency in lower case',
      argv: withOption('--currency', 'mkd'),
      option: '--currency',
      typed: 'mkd',
    },
    {
      what: 'a currency of two letters',
      argv: withOption('--currency', 'MK'),
      option: '--currency',
      typed: 'MK,',
    },
    { what: 'an empty name', argv: withOption('--name', ''), option: '--name', typed: 'Lakeside' },
    {
      what: 'a name of spaces only',
      argv: withOption('--name', '   '),
      option: '--name',
      typed: 'Lakeside',
    },
    { what: 'no name', argv: withOption('--name', undefined), option: '--name', typed: 'Lakeside' },
    {
      what: "an empty owner's name",
      argv: withOption('--owner-name', ' '),
      option: '--owner-name',
      typed: 'Lakeside',
    },
    {
      what: 'a locale other than en',
      argv: withOption('--locale', 'mk'),
      option: '--locale',
      typed: 'mk',
    },
  ])('$what', async ({ argv, option, typed }) => {
    await expectRefusedBeforeConnecting(argv, `${option} must be`);
    // Nothing typed is repeated: an email is personal (`typed` is a piece of what was typed).
    const refusal = written.join('\n').replace(USAGE, '');
    expect(refusal).not.toContain(typed);
    expect(refusal).not.toContain('example.test');
    expect(refusal).not.toMatch(/\bat\s.*\(.*:\d+:\d+\)/); // no stack
  });

  it('names every field that cannot be used at once', async () => {
    await expectRefusedBeforeConnecting(
      [
        '--name',
        '',
        '--owner-email',
        'nobody',
        '--time-zone',
        'Mars/Olympus',
        '--country',
        'UK',
        '--currency',
        'denar',
      ],
      'Refused, nothing written:',
    );
    const lines = written.join('\n').split('\n');
    for (const option of [
      '--name',
      '--owner-email',
      '--owner-name',
      '--time-zone',
      '--country',
      '--currency',
    ]) {
      expect(
        lines.filter((line) => line.startsWith(`  ${option} must be`)),
        option,
      ).toHaveLength(1);
    }
  });

  it('an option it does not know, or a value without its option, repeating neither', async () => {
    await expectRefusedBeforeConnecting(
      [...VALID, '--owner-mail', 'other-owner@example.test'],
      'an option it does not know',
    );
    expect(written.join('\n')).not.toContain('other-owner');
    written.length = 0;
    await expectRefusedBeforeConnecting(
      [...VALID, 'stray@example.test'],
      'an option it does not know',
    );
    expect(written.join('\n')).not.toContain('stray');
  });
});

describe('where it runs: refused before it connects (acceptance 6)', () => {
  it('a database that is not on this machine, without --remote-database', async () => {
    vi.stubEnv('DATABASE_URL', REMOTE_APP_URL);
    await expectRefusedBeforeConnecting(
      VALID,
      'Refused, nothing written: DATABASE_URL names a database on "db.example.invalid", not on this machine. Add --remote-database',
    );
  });

  it('a host given in the query string, which pg uses over the URL', async () => {
    vi.stubEnv('DATABASE_URL', `${LOCAL_APP_URL}?host=db.example.invalid`);
    await expectRefusedBeforeConnecting(VALID, 'names a database on "db.example.invalid"');
  });

  it('a host left out, so that pg takes PGHOST', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://chairside_app:pw@/guard_db');
    vi.stubEnv('PGHOST', 'db.example.invalid');
    await expectRefusedBeforeConnecting(VALID, 'names a database on "db.example.invalid"');
  });

  it('a role other than the app role, given in the URL or in its query string', async () => {
    for (const url of [
      LOCAL_APP_URL.replace('chairside_app', 'chairside_migrator'),
      `${LOCAL_APP_URL}?user=postgres`,
    ]) {
      vi.stubEnv('DATABASE_URL', url);
      written.length = 0;
      await expectRefusedBeforeConnecting(VALID, 'DATABASE_URL must connect as chairside_app');
    }
  });

  it.each(['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'])(
    'a setting it reads, %s, not set',
    async (setting) => {
      vi.stubEnv(setting, '');
      await expectRefusedBeforeConnecting(VALID, `Refused, nothing written: ${setting} not set.`);
    },
  );

  it('with --remote-database, a database elsewhere passes the guard: the run then connects', async () => {
    vi.stubEnv('DATABASE_URL', REMOTE_APP_URL);
    expect(await connectionRefusedIn(runClinicCreate([...VALID, '--remote-database']))).toBe(true);
    expect(connections[1]!.mock.calls.length).toBeGreaterThan(0);
  });

  it('this machine, with NODE_ENV=production: no refusal, as on a host the script runs there', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await connectionRefusedIn(runClinicCreate(VALID))).toBe(true);
  });
});
