import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { TenantTransaction } from '@/db/tenant';
import { isUuid } from '@/lib/ids';
import { withoutQueryValues } from '@/lib/query-errors';
import { isExtraPermission, isRole, type ExtraPermission, type Role } from './permissions';
import type { ClinicChoice } from './resolve-clinic';
import { memberships } from './schema';

export interface Membership {
  id: string;
  clinicId: string;
  userId: string;
  role: Role;
  extraPermissions: ExtraPermission[];
  status: 'active' | 'disabled';
}

/**
 * The clinics a user may enter: one entry per active membership, by clinic name. This is a
 * cross-clinic lookup by design (there is no clinic yet when a user signs in), so it goes through
 * the one named database function `clinics_for_user()` (migration 0001, on the allow-list in
 * tests/integration/tenant-allow-list.ts). The function returns clinic id, clinic name, role and
 * extra permissions for that one user, nothing else.
 *
 * A failed query throws the copy withoutQueryValues() makes, without the user id it was sent
 * (D-070): every page and action calls this, and Next.js prints an error that escapes them.
 */
export async function clinicsForUser(userId: string): Promise<ClinicChoice[]> {
  if (!isUuid(userId)) throw new TypeError('clinicsForUser: userId must be a UUID');
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await getDb().execute(sql`
      select membership_id, clinic_id, clinic_name, role, extra_permissions
      from clinics_for_user(${userId})`));
  } catch (error) {
    throw withoutQueryValues(error);
  }
  return rows.map((row) => ({
    membershipId: String(row.membership_id),
    clinicId: String(row.clinic_id),
    clinicName: String(row.clinic_name),
    role: toRole(row.role),
    extraPermissions: toExtraPermissions(row.extra_permissions),
  }));
}

/**
 * The user's active membership in the clinic of this transaction, or null. Row-Level Security
 * means a transaction for clinic A can only ever find a membership in clinic A.
 */
export async function activeMembership(
  tx: TenantTransaction,
  userId: string,
): Promise<Membership | null> {
  if (!isUuid(userId)) throw new TypeError('activeMembership: userId must be a UUID');
  const [row] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
  if (!row) return null;
  return {
    id: row.id,
    clinicId: row.clinicId,
    userId: row.userId,
    role: toRole(row.role),
    extraPermissions: toExtraPermissions(row.extraPermissions),
    status: row.status === 'disabled' ? 'disabled' : 'active',
  };
}

function toRole(value: unknown): Role {
  if (!isRole(value)) throw new Error('memberships: a row holds a role the code does not know');
  return value;
}

function toExtraPermissions(value: unknown): ExtraPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isExtraPermission);
}
