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

  it('refuses migration and app connections to different databases', () => {
    const urls = { ...LOCAL, appUrl: LOCAL.appUrl.replace('/guard_db', '/other_db') };
    expect(() => checkResetTargets(urls)).toThrow('must name the same database');
  });
});
