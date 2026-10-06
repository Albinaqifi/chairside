/**
 * Who a person is (the auth library), which clinics they may enter (memberships) and what their
 * role allows (permissions). Public API of the auth module.
 */
export {
  cookiesAreSecure,
  getAuth,
  SESSION_IDLE_SECONDS,
  SESSION_REFRESH_SECONDS,
  SIGN_IN_RATE_LIMIT,
  type Auth,
} from './better-auth';
export { activeMembership, clinicsForUser, type Membership } from './memberships';
export {
  can,
  EXTRA_PERMISSIONS,
  isExtraPermission,
  isRole,
  PERMISSION_TABLE,
  PERMISSIONS,
  PROVIDER_KINDS,
  ROLES,
  type ExtraPermission,
  type Grant,
  type MembershipExtras,
  type Permission,
  type ProviderKind,
  type Role,
} from './permissions';
export { resolveClinic, type ClinicChoice, type ClinicResolution } from './resolve-clinic';
export { createStaffUser, type NewStaffUser } from './users';
