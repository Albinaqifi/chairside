import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import type { TenantTransaction } from '@/db/tenant';
import { isUuid, newId } from '@/lib/ids';
import { withoutQueryValues } from '@/lib/query-errors';
import {
  isExtraPermission,
  isProviderKind,
  isRole,
  type ExtraPermission,
  type ProviderKind,
  type Role,
} from './permissions';
import type { ClinicChoice } from './resolve-clinic';
import { memberships } from './schema';

export interface Membership {
  id: string;
  clinicId: string;
  userId: string;
  role: Role;
  extraPermissions: ExtraPermission[];
  status: 'active' | 'disabled';
  /**
   * The provider whose calendar column is the person's own (memberships.provider_id, E01-T01a), or
   * null. The calendar opens on that column (E01-T04b); no permission comes from it.
   */
  providerId: string | null;
}

/**
 * The clinics a user may enter: one entry per active membership, by clinic name. This is a
 * cross-clinic lookup by design (there is no clinic yet when a user signs in), so it goes through
 * the one named database function `clinics_for_user()` (migrations 0001 and 0002, on the allow-list
 * in tests/integration/tenant-allow-list.ts). The function returns clinic id, clinic name, role,
 * extra permissions and the kind of the linked provider for that one user, nothing else (D-091).
 *
 * A failed query throws the copy withoutQueryValues() makes, without the user id it was sent
 * (D-070): every page and action calls this, and Next.js prints an error that escapes them.
 */
export async function clinicsForUser(userId: string): Promise<ClinicChoice[]> {
  if (!isUuid(userId)) throw new TypeError('clinicsForUser: userId must be a UUID');
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await getDb().execute(sql`
      select membership_id, clinic_id, clinic_name, role, extra_permissions, provider_kind
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
    providerKind: toProviderKind(row.provider_kind),
  }));
}

/**
 * The user's active membership in the clinic of this transaction, or null. Row-Level Security
 * means a transaction for clinic A can only ever find a membership in clinic A. With its linked
 * provider (E01-T04b): read here, in the clinic's own transaction, not through clinics_for_user()
 * (D-091, "Revisit if").
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
    providerId: row.providerId,
  };
}

/**
 * The providers of the clinic of this transaction that a membership is linked to (its provider_id),
 * active or disabled, each once (E01-T09d): Settings locks their kind, which an owner's aftercare
 * approval follows (D-051; owner, D-118). A disabled membership counts too, as it may be made active
 * again with its link. Row-Level Security limits the read to the clinic's own memberships; nothing
 * else of them is read.
 */
export async function linkedProviderIds(tx: TenantTransaction): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ providerId: memberships.providerId })
    .from(memberships)
    .where(isNotNull(memberships.providerId))
    .orderBy(asc(memberships.providerId));
  return rows.flatMap((row) => (row.providerId === null ? [] : [row.providerId]));
}

/**
 * Adds the person to the clinic of this transaction with this role, and gives the membership's id.
 * Its clinic is the transaction's own (current_clinic_id()), which the policy checks too: a
 * transaction adds members to its own clinic only. `pnpm clinic:create` adds a new clinic's first
 * owner with it (E00-T05b); staff management will add the rest (E04).
 */
export async function addMembership(
  tx: TenantTransaction,
  { userId, role }: { userId: string; role: Role },
  now: Date,
): Promise<string> {
  if (!isUuid(userId)) throw new TypeError('addMembership: userId must be a UUID');
  const id = newId();
  await tx.insert(memberships).values({
    id,
    clinicId: sql`current_clinic_id()`,
    userId,
    role,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function toRole(value: unknown): Role {
  if (!isRole(value)) throw new Error('memberships: a row holds a role the code does not know');
  return value;
}

function toExtraPermissions(value: unknown): ExtraPermission[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isExtraPermission);
}

/**
 * Null when the membership is linked to no provider. A kind the code does not know (the column's
 * check allows none) also gives null: no permission comes from it, as with an unknown extra
 * permission, and the person can still sign in.
 */
function toProviderKind(value: unknown): ProviderKind | null {
  return isProviderKind(value) ? value : null;
}
