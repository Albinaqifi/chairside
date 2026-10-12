import { describe, expect, it } from 'vitest';
import { isClinicTimeZoneName } from './time-zone';

// E01-T08a, acceptance 2 (D-110): which names a clinic's zone may have before the database is asked,
// as `pnpm clinic:create` checks them before it connects and the Settings form at its field. Whether
// the database knows the name is knownTimeZone()'s: tests/integration/clinic-settings.test.ts and
// tests/integration/clinic-create.test.ts. Read with this machine's Intl (Node's ICU), whatever its
// zone: nothing here depends on the computer's own (D-099).

describe('isClinicTimeZoneName: a region by its name, or UTC, that Intl knows', () => {
  it.each([
    'Europe/Skopje',
    'europe/skopje',
    'EUROPE/SKOPJE',
    'UTC',
    'utc',
    'Europe/Kyiv', // Intl's list lacks it, and spells it Europe/Kiev; Intl takes it all the same
    'America/Argentina/Buenos_Aires', // three parts, and Intl spells it the old way too
    'Pacific/Auckland',
    'America/New_York',
  ])('takes %s', (name) => {
    expect(isClinicTimeZoneName(name)).toBe(true);
  });

  it.each([
    {
      name: '+01:00',
      why: 'an offset: Intl reads it an hour east of UTC, PostgreSQL an hour west',
    },
    { name: '-05:00', why: 'an offset' },
    { name: '+0100', why: 'an offset written without its colon, which Intl reads as +01:00' },
    { name: '+01', why: 'an offset of hours alone' },
    { name: 'Etc/GMT-1', why: 'a fixed zone: it never moves to summer time' },
    { name: 'etc/gmt-1', why: 'a fixed zone, in another case' },
    { name: 'Etc/UTC', why: 'UTC under Etc/: the one UTC is UTC' },
    { name: 'GMT', why: 'no region, and not UTC' },
    { name: 'EST', why: 'an abbreviation, which Intl reads as America/Panama' },
    { name: 'Factory', why: 'a name of the database that Intl does not know' },
    { name: 'Mars/Olympus', why: 'a region nobody knows' },
    { name: 'Europe/Skopie', why: 'a name misspelt' },
    { name: ' Europe/Skopje', why: 'a name with a space in front, which Intl refuses' },
    { name: '', why: 'nothing' },
  ])('refuses $name: $why', ({ name }) => {
    expect(isClinicTimeZoneName(name)).toBe(false);
  });

  it('takes a name Intl knows that the database may not: whether it does is the database check', () => {
    // Europe/Kiev is what Intl calls Kyiv; the postgres:18 image knows only Europe/Kyiv (D-110).
    expect(isClinicTimeZoneName('Europe/Kiev')).toBe(true);
    expect(isClinicTimeZoneName('Asia/Calcutta')).toBe(true);
  });
});
