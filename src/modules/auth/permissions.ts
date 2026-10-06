/**
 * Roles and permissions (D-021, data-model.md section 1). The table below is the "Navigation
 * and roles" table of scope-v1.md, one row per permission, so a reviewer can compare them line
 * by line. Permissions are checked on the server for every action (E00-T03); hiding a button is
 * never the check.
 */

// How a role is shown to people is in the message file (src/i18n/en.json, roles), by its key here.
export const ROLES = ['owner', 'dentist', 'hygienist', 'front_desk'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'calendar.manage',
  'patients.manage',
  'visit.record',
  'aftercare.approve',
  'automations.manage',
  'import.run',
  'export.run',
  'staff.manage',
  'settings.manage',
  'audit.view',
  'results.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Per-person additions to a role (D-021). Only front desk can be given them (scope-v1.md). */
export const EXTRA_PERMISSIONS = ['import', 'export'] as const;
export type ExtraPermission = (typeof EXTRA_PERMISSIONS)[number];

/** The kinds of provider a membership can be linked to (its calendar column, E01, data-model.md). */
export const PROVIDER_KINDS = ['dentist', 'hygienist', 'other'] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** What a membership adds to its role. */
export interface MembershipExtras {
  extraPermissions: readonly ExtraPermission[];
  /** The kind of provider this person is linked to, or null if not linked to a calendar column. */
  providerKind: ProviderKind | null;
}

/**
 * When a role has a permission:
 * - `always` / `never`: by role alone;
 * - `linked_to_provider`: only if the membership is linked to a provider of any kind;
 * - `linked_to_dentist`: only if the membership is linked to a provider of kind dentist (D-051);
 * - `extra_import` / `extra_export`: only with that extra permission on the membership.
 */
export type Grant =
  'always' | 'never' | 'linked_to_provider' | 'linked_to_dentist' | 'extra_import' | 'extra_export';

type Row = Readonly<Record<Role, Grant>>;

const everyone: Row = {
  owner: 'always',
  dentist: 'always',
  hygienist: 'always',
  front_desk: 'always',
};
const ownerOnly: Row = {
  owner: 'always',
  dentist: 'never',
  hygienist: 'never',
  front_desk: 'never',
};

/** The permission table: scope-v1.md, "Navigation and roles". */
export const PERMISSION_TABLE: Readonly<Record<Permission, Row>> = {
  // Calendar, patients, booking: everyone.
  'calendar.manage': everyone,
  'patients.manage': everyone,
  // Visit wrap-up: owner only if linked to a provider.
  'visit.record': { ...everyone, owner: 'linked_to_provider' },
  // Approve, edit or discard aftercare; approve library templates: dentists only (D-051).
  'aftercare.approve': {
    owner: 'linked_to_dentist',
    dentist: 'always',
    hygienist: 'never',
    front_desk: 'never',
  },
  // Edit automations and care plans.
  'automations.manage': ownerOnly,
  // Import patients, export data: front desk only with the extra permission.
  'import.run': { ...ownerOnly, front_desk: 'extra_import' },
  'export.run': { ...ownerOnly, front_desk: 'extra_export' },
  // Staff, settings, audit log, results panel.
  'staff.manage': ownerOnly,
  'settings.manage': ownerOnly,
  'audit.view': ownerOnly,
  'results.view': ownerOnly,
};

/**
 * True if a member with this role and these extras has the permission. Pure. Values from outside
 * the type system (a database row, a JavaScript caller) fail closed: a role, permission or
 * provider kind it does not know gives false.
 */
export function can(role: Role, extras: MembershipExtras, permission: Permission): boolean {
  const row: Row | undefined = Object.hasOwn(PERMISSION_TABLE, permission)
    ? PERMISSION_TABLE[permission]
    : undefined;
  const grant: Grant | undefined = row && Object.hasOwn(row, role) ? row[role] : undefined;
  switch (grant) {
    case 'always':
      return true;
    case 'linked_to_provider':
      return isProviderKind(extras.providerKind);
    case 'linked_to_dentist':
      return extras.providerKind === 'dentist';
    case 'extra_import':
      return extras.extraPermissions.includes('import');
    case 'extra_export':
      return extras.extraPermissions.includes('export');
    default:
      // 'never', and anything the table does not hold.
      return false;
  }
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && (PROVIDER_KINDS as readonly string[]).includes(value);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isExtraPermission(value: unknown): value is ExtraPermission {
  return typeof value === 'string' && (EXTRA_PERMISSIONS as readonly string[]).includes(value);
}
