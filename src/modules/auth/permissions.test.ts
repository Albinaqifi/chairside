import { describe, expect, it } from 'vitest';
import {
  can,
  PERMISSIONS,
  ROLES,
  type MembershipExtras,
  type Permission,
  type Role,
} from './permissions';

// The expected answers are written out again here, straight from the "Navigation and roles"
// table in scope-v1.md, so the test does not just re-read the constant it checks.

const nothing: MembershipExtras = { extraPermissions: [], providerKind: null };
const importer: MembershipExtras = { extraPermissions: ['import'], providerKind: null };
const exporter: MembershipExtras = { extraPermissions: ['export'], providerKind: null };
const both: MembershipExtras = { extraPermissions: ['import', 'export'], providerKind: null };
const asDentist: MembershipExtras = { extraPermissions: [], providerKind: 'dentist' };
const asHygienist: MembershipExtras = { extraPermissions: [], providerKind: 'hygienist' };

const extrasByName = { nothing, importer, exporter, both, asDentist, asHygienist };
type ExtrasName = keyof typeof extrasByName;

/** Role × permission → which extras make it true (`all` = any extras, `none` = never). */
const expected: Record<Permission, Record<Role, 'all' | 'none' | ExtrasName[]>> = {
  'calendar.manage': { owner: 'all', dentist: 'all', hygienist: 'all', front_desk: 'all' },
  'patients.manage': { owner: 'all', dentist: 'all', hygienist: 'all', front_desk: 'all' },
  'visit.record': {
    owner: ['asDentist', 'asHygienist'],
    dentist: 'all',
    hygienist: 'all',
    front_desk: 'all',
  },
  'aftercare.approve': {
    owner: ['asDentist'],
    dentist: 'all',
    hygienist: 'none',
    front_desk: 'none',
  },
  'automations.manage': { owner: 'all', dentist: 'none', hygienist: 'none', front_desk: 'none' },
  'import.run': {
    owner: 'all',
    dentist: 'none',
    hygienist: 'none',
    front_desk: ['importer', 'both'],
  },
  'export.run': {
    owner: 'all',
    dentist: 'none',
    hygienist: 'none',
    front_desk: ['exporter', 'both'],
  },
  'staff.manage': { owner: 'all', dentist: 'none', hygienist: 'none', front_desk: 'none' },
  'settings.manage': { owner: 'all', dentist: 'none', hygienist: 'none', front_desk: 'none' },
  'audit.view': { owner: 'all', dentist: 'none', hygienist: 'none', front_desk: 'none' },
  'results.view': { owner: 'all', dentist: 'none', hygienist: 'none', front_desk: 'none' },
};

const cases = PERMISSIONS.flatMap((permission) =>
  ROLES.flatMap((role) =>
    (Object.keys(extrasByName) as ExtrasName[]).map((extras) => {
      const rule = expected[permission][role];
      const allowed = rule === 'all' ? true : rule === 'none' ? false : rule.includes(extras);
      return { permission, role, extras, allowed };
    }),
  ),
);

describe('can(role, extras, permission): every role × permission in scope-v1.md', () => {
  it.each(cases)(
    '$role with $extras → $permission is $allowed',
    ({ permission, role, extras, allowed }) => {
      expect(can(role, extrasByName[extras], permission)).toBe(allowed);
    },
  );

  it('covers every permission and every role', () => {
    expect(Object.keys(expected).sort()).toEqual([...PERMISSIONS].sort());
    for (const permission of PERMISSIONS) {
      expect(Object.keys(expected[permission]).sort()).toEqual([...ROLES].sort());
    }
  });

  it('extra permissions do nothing for dentists and hygienists', () => {
    for (const role of ['dentist', 'hygienist'] as const) {
      expect(can(role, both, 'import.run')).toBe(false);
      expect(can(role, both, 'export.run')).toBe(false);
    }
  });

  it('an owner linked to a hygienist column records visits but does not approve aftercare', () => {
    expect(can('owner', asHygienist, 'visit.record')).toBe(true);
    expect(can('owner', asHygienist, 'aftercare.approve')).toBe(false);
  });
});

// Tester, E00-T02: the cases the table above does not name.
describe('can(): kinds and values the table leaves out', () => {
  const asOther: MembershipExtras = { extraPermissions: [], providerKind: 'other' };

  it('an owner linked to a provider of kind "other" records visits but does not approve aftercare', () => {
    expect(can('owner', asOther, 'visit.record')).toBe(true);
    expect(can('owner', asOther, 'aftercare.approve')).toBe(false);
  });

  it('a link to a dentist column gives front desk and hygienists nothing extra', () => {
    for (const role of ['front_desk', 'hygienist'] as const) {
      expect(can(role, asDentist, 'aftercare.approve')).toBe(false);
      expect(can(role, asDentist, 'import.run')).toBe(false);
    }
  });

  it('answers false, never undefined, for a role or link it does not know', () => {
    // Values from outside the type system (a database row, a JavaScript caller) must fail closed.
    expect(can('admin' as Role, nothing, 'calendar.manage')).toBe(false);
    const unlinked = { extraPermissions: [] } as unknown as MembershipExtras; // providerKind missing
    expect(can('owner', unlinked, 'visit.record')).toBe(false);
  });
});
