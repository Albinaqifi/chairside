import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkResetTargets, type DatabaseUrls } from './reset';

// The guard of `pnpm db:reset`. These tests call only the check, which never connects. The URLs
// are made up; `.invalid` host names never resolve (RFC 2606).
const LOCAL: DatabaseUrls = {
  adminUrl: 'postgres://postgres:pw@127.0.0.1:5433/postgres',
  migratorUrl: 'postgres://guard_migrator:pw@127.0.0.1:5433/guard_db',
  appUrl: 'postgres://chairside_app:pw@127.0.0.1:5433/guard_db',
};
const URL_NAMES = ['adminUrl', 'migratorUrl', 'appUrl'] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the db:reset guard', () => {
  it('accepts this machine by any of its names', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const urls = Object.fromEntries(
        URL_NAMES.map((name) => [name, LOCAL[name].replace('127.0.0.1', host)]),
      ) as unknown as DatabaseUrls;
      expect(checkResetTargets(urls)).toMatchObject({
        migrator: { user: 'guard_migrator', database: 'guard_db' },
        app: { user: 'chairside_app', database: 'guard_db' },
      });
    }
  });

  it.each(URL_NAMES)('refuses a host that is not this machine in %s', (name) => {
    const urls = { ...LOCAL, [name]: LOCAL[name].replace('127.0.0.1', 'db.example.invalid') };
    expect(() => checkResetTargets(urls)).toThrow(
      'Refusing to reset a database on "db.example.invalid"',
    );
  });

  it.each(URL_NAMES)('refuses a host given in the query string of %s, which pg uses', (name) => {
    // pg takes host, port and user from the query string over the URL's own parts.
    const urls = { ...LOCAL, [name]: `${LOCAL[name]}?host=db.example.invalid` };
    expect(() => checkResetTargets(urls)).toThrow(
      'Refusing to reset a database on "db.example.invalid"',
    );
  });

  it('refuses when NODE_ENV is production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => checkResetTargets(LOCAL)).toThrow('NODE_ENV is production');
  });

  it('refuses an app role other than chairside_app, also one given in the query string', () => {
    const otherUser = { ...LOCAL, appUrl: LOCAL.appUrl.replace('chairside_app', 'postgres') };
    expect(() => checkResetTargets(otherUser)).toThrow(
      'DATABASE_URL must connect as chairside_app',
    );
    const queryUser = { ...LOCAL, appUrl: `${LOCAL.appUrl}?user=postgres` };
    expect(() => checkResetTargets(queryUser)).toThrow(
      'DATABASE_URL must connect as chairside_app',
    );
  });

  it.each(URL_NAMES)('refuses %s on another port of this machine', (name) => {
    // Another PostgreSQL server can listen on this machine, for example on the default port.
    const urls = { ...LOCAL, [name]: LOCAL[name].replace(':5433', ':5432') };
    expect(() => checkResetTargets(urls)).toThrow('must name the same host and port');
  });

  it.each(URL_NAMES)('refuses a port given in the query string of %s, which pg uses', (name) => {
    const urls = { ...LOCAL, [name]: `${LOCAL[name]}?port=5432` };
    expect(() => checkResetTargets(urls)).toThrow('must name the same host and port');
  });

  it('refuses this machine named in two ways, which may be two servers', () => {
    const urls = { ...LOCAL, adminUrl: LOCAL.adminUrl.replace('127.0.0.1', 'localhost') };
    expect(() => checkResetTargets(urls)).toThrow(
      'must name the same host and port (they name localhost:5433, 127.0.0.1:5433, 127.0.0.1:5433)',
    );
  });

  it('compares the port pg will use for a URL without one: PGPORT, or else 5432', () => {
    const withoutPort = (url: string) => url.replace(':5433', '');
    const adminWithoutPort = { ...LOCAL, adminUrl: withoutPort(LOCAL.adminUrl) };
    expect(() => checkResetTargets(adminWithoutPort)).toThrow('must name the same host and port');
    const noPorts = Object.fromEntries(
      URL_NAMES.map((name) => [name, withoutPort(LOCAL[name])]),
    ) as unknown as DatabaseUrls;
    expect(() => checkResetTargets(noPorts)).not.toThrow();

    vi.stubEnv('PGPORT', '5433');
    expect(() => checkResetTargets(adminWithoutPort)).not.toThrow();
  });

  it('refuses migration and app connections to different databases', () => {
    const urls = { ...LOCAL, appUrl: LOCAL.appUrl.replace('/guard_db', '/other_db') };
    expect(() => checkResetTargets(urls)).toThrow('must name the same database');
  });

  it('refuses other connection-string forms that send pg to another host', () => {
    // Added by the tester (round 2). A URL without a host makes pg use PGHOST.
    vi.stubEnv('PGHOST', 'db.example.invalid');
    expect(() =>
      checkResetTargets({ ...LOCAL, adminUrl: 'postgres://postgres:pw@/postgres' }),
    ).toThrow('Refusing to reset a database on "db.example.invalid"');
    vi.unstubAllEnvs();

    for (const adminUrl of [
      `${LOCAL.adminUrl}?host=localhost&host=db.example.invalid`, // pg takes the last one
      'postgres://postgres:pw@localhost,db.example.invalid:5433/postgres', // two hosts
      'postgres://postgres:pw@%2Ftmp/postgres', // a socket folder
      'socket://postgres:pw@/var/run/postgresql?db=postgres',
      'host=db.example.invalid dbname=postgres user=postgres password=pw', // key=value form
    ]) {
      expect(() => checkResetTargets({ ...LOCAL, adminUrl }), adminUrl).toThrow(
        'Refusing to reset a database on',
      );
    }
  });
});
