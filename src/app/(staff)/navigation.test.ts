import { describe, expect, it } from 'vitest';
import messages from '@/i18n/en.json';
import type { ClinicChoice, MembershipExtras, Role } from '@/modules/auth';
import { membershipExtras, NAVIGATION, navigationFor } from './navigation';

// E00-T04b, acceptance 2: the navigation each role sees. The expected lists are written out from the
// task's words (scope-v1.md, "Navigation and roles"), not read back from the permission table.

const nothing: MembershipExtras = { extraPermissions: [], providerKind: null };
const importer: MembershipExtras = { extraPermissions: ['import'], providerKind: null };
const exporter: MembershipExtras = { extraPermissions: ['export'], providerKind: null };
const both: MembershipExtras = { extraPermissions: ['import', 'export'], providerKind: null };
const asDentist: MembershipExtras = { extraPermissions: [], providerKind: 'dentist' };
const asHygienist: MembershipExtras = { extraPermissions: [], providerKind: 'hygienist' };
const asOther: MembershipExtras = { extraPermissions: [], providerKind: 'other' };

/** The labels a member sees, in order, as the message file names the items. */
function seen(role: Role, extras: MembershipExtras): string[] {
  return navigationFor(role, extras).map((item) => messages.nav[item.key]);
}

const FRONT_DESK = ['Today', 'Calendar', 'In the chair', 'Patients'];

describe('the navigation of each role (E00-T04b, acceptance 2)', () => {
  it.each([
    { who: 'front desk', extras: nothing, sees: FRONT_DESK },
    {
      who: 'front desk with the import permission',
      extras: importer,
      sees: [...FRONT_DESK, 'Import patients'],
    },
    { who: 'front desk with the export permission only', extras: exporter, sees: FRONT_DESK },
    {
      who: 'front desk with both permissions',
      extras: both,
      sees: [...FRONT_DESK, 'Import patients'],
    },
    { who: 'front desk linked to a dentist column', extras: asDentist, sees: FRONT_DESK },
  ])('$who sees $sees', ({ extras, sees }) => {
    expect(seen('front_desk', extras)).toEqual(sees);
  });

  it.each([
    { who: 'a hygienist', extras: nothing },
    { who: 'a hygienist with the import permission', extras: importer },
    { who: 'a hygienist with both permissions', extras: both },
    { who: 'a hygienist linked to a hygienist column', extras: asHygienist },
  ])('$who sees what front desk sees, never Import patients', ({ extras }) => {
    expect(seen('hygienist', extras)).toEqual(FRONT_DESK);
  });

  it.each([
    { who: 'a dentist', extras: nothing },
    { who: 'a dentist with both permissions', extras: both },
    { who: 'a dentist linked to a dentist column', extras: asDentist },
  ])('$who also sees Automations, never Import patients or Settings', ({ extras }) => {
    expect(seen('dentist', extras)).toEqual([...FRONT_DESK, 'Automations']);
  });

  it('an owner who is not linked to a provider: no In the chair', () => {
    expect(seen('owner', nothing)).toEqual([
      'Today',
      'Calendar',
      'Patients',
      'Automations',
      'Import patients',
      'Settings',
    ]);
  });

  it.each([
    { who: 'a dentist', extras: asDentist },
    { who: 'a hygienist', extras: asHygienist },
    { who: 'another kind of', extras: asOther },
  ])('an owner linked to $who provider also sees In the chair', ({ extras }) => {
    expect(seen('owner', extras)).toEqual([
      'Today',
      'Calendar',
      'In the chair',
      'Patients',
      'Automations',
      'Import patients',
      'Settings',
    ]);
  });

  it('a role the code does not know sees only Today, which every member may open', () => {
    // can() fails closed for a value from outside the type system (a database row).
    expect(seen('admin' as Role, both)).toEqual(['Today']);
  });
});

describe("the staff layout reads the navigation with the membership's own extras (D-091)", () => {
  const choice: ClinicChoice = {
    membershipId: '01970000-0000-7000-8000-000000000001',
    clinicId: '01970000-0000-7000-8000-000000000002',
    clinicName: 'Test clinic (synthetic)',
    role: 'owner',
    extraPermissions: ['import'],
    providerKind: null,
  };

  it("passes the membership's extra permissions on, and no provider when it is linked to none", () => {
    expect(membershipExtras(choice)).toEqual({ extraPermissions: ['import'], providerKind: null });
  });

  it('so an owner linked to no provider sees no In the chair, and front desk with import sees Import patients', () => {
    expect(seen('owner', membershipExtras(choice))).not.toContain('In the chair');
    const desk = membershipExtras({ ...choice, role: 'front_desk' });
    expect(seen('front_desk', desk)).toEqual([...FRONT_DESK, 'Import patients']);
  });

  // E01-T01a: the membership is linked to a provider, and clinics_for_user() gave its kind.
  it.each(['dentist', 'hygienist', 'other'] as const)(
    'passes the kind of the linked provider on: an owner linked to a %s column sees In the chair',
    (kind) => {
      const linked: ClinicChoice = { ...choice, providerKind: kind };
      expect(membershipExtras(linked)).toEqual({
        extraPermissions: ['import'],
        providerKind: kind,
      });
      expect(seen('owner', membershipExtras(linked))).toContain('In the chair');
    },
  );
});

describe('the navigation list', () => {
  it("holds the task's items, paths and groups, in the demo's order", () => {
    expect(NAVIGATION.map(({ key, path, group }) => ({ key, path, group }))).toEqual([
      { key: 'today', path: '/', group: 'main' },
      { key: 'calendar', path: '/calendar', group: 'main' },
      { key: 'visit', path: '/visit', group: 'main' },
      { key: 'patients', path: '/patients', group: 'main' },
      { key: 'automations', path: '/automations', group: 'main' },
      { key: 'import', path: '/import', group: 'more' },
      { key: 'settings', path: '/settings', group: 'more' },
    ]);
  });

  it('names what each item needs: every member, or any one of its permissions', () => {
    expect(Object.fromEntries(NAVIGATION.map(({ key, needs }) => [key, needs]))).toEqual({
      today: 'every_member',
      calendar: ['calendar.manage'],
      visit: ['visit.record'],
      patients: ['patients.manage'],
      automations: ['automations.manage', 'aftercare.approve'],
      import: ['import.run'],
      settings: ['settings.manage'],
    });
  });

  it('gives the browser only what it shows: key, path and group', () => {
    for (const item of navigationFor('owner', asDentist)) {
      expect(Object.keys(item).sort()).toEqual(['group', 'key', 'path']);
    }
  });
});
