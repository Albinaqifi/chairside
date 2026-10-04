import { sql } from 'drizzle-orm';
import type { TenantTransaction } from '@/db/tenant';
import { isUuid, newId } from '@/lib/ids';
import { isPersonalField } from '@/lib/personal-fields';
import { auditLog } from './schema';

/** Who can act: a staff member, a patient through a link (E02), or the system (jobs). */
export const ACTOR_TYPES = ['user', 'patient_link', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** A metadata value: ids, codes, field names, counts. Only what JSON holds. */
export type AuditValue =
  string | number | boolean | null | readonly AuditValue[] | { readonly [key: string]: AuditValue };

/** Extra facts about an audited event: ids, codes and field names, never personal values. */
export type AuditMetadata = { readonly [key: string]: AuditValue };

/** One audited event. */
export interface AuditEntry {
  /** When it happened: the caller's "now", never read from the clock here. */
  at: Date;
  actorType: ActorType;
  /** The user's or the patient link's id; null for the system. */
  actorId: string | null;
  /** What happened, as `<entity>.<what happened>`: `patient.created`, `user.logged_in`. */
  action: string;
  /** What it happened to, as a code (`patient`), with its id. */
  entityType: string | null;
  entityId: string | null;
  /** Ids, codes and field names only (data-model.md, Conventions). */
  metadata?: AuditMetadata;
}

/** `patient.created`, `user.logged_in`: lower-case words joined by dots. */
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** `patient`, `aftercare_draft`. */
const ENTITY_TYPE = /^[a-z][a-z0-9_]*$/;

/**
 * Writes one row to the audit log, in the clinic of the transaction (withTenant), and returns its
 * id. The row cannot name another clinic: its clinic is the transaction's own.
 *
 * It throws, so that the caller's transaction rolls back and the audited change is not kept
 * either, when the entry is malformed: an invalid time, an id that is not a UUID, an action or
 * entity type that is not a code (no free text, which could hold personal data), or metadata that
 * holds a personal field name at any depth (src/lib/personal-fields.ts). The metadata is checked
 * exactly as it will be stored, after conversion to JSON.
 */
export async function record(tx: TenantTransaction, entry: AuditEntry): Promise<string> {
  const metadata = checkedEntry(entry);
  const id = newId();
  await tx.insert(auditLog).values({
    id,
    clinicId: sql`current_clinic_id()`,
    at: entry.at,
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata,
  });
  return id;
}

/** Throws unless the entry may be written; returns its metadata as it will be stored. */
export function checkedEntry(entry: AuditEntry): Record<string, unknown> {
  if (!(entry.at instanceof Date) || Number.isNaN(entry.at.getTime())) {
    throw new TypeError('audit.record: `at` must be a valid Date');
  }
  if (!(ACTOR_TYPES as readonly unknown[]).includes(entry.actorType)) {
    throw new TypeError('audit.record: unknown actor type');
  }
  if (entry.actorId === null ? entry.actorType !== 'system' : !isUuid(entry.actorId)) {
    throw new TypeError('audit.record: actorId must be a UUID, or null for the system');
  }
  if (typeof entry.action !== 'string' || !ACTION.test(entry.action)) {
    throw new TypeError('audit.record: action must be a code such as "patient.created"');
  }
  if (
    entry.entityType !== null &&
    (typeof entry.entityType !== 'string' || !ENTITY_TYPE.test(entry.entityType))
  ) {
    throw new TypeError('audit.record: entityType must be a code such as "patient"');
  }
  if (entry.entityId !== null && !isUuid(entry.entityId)) {
    throw new TypeError('audit.record: entityId must be a UUID or null');
  }
  return storedMetadata(entry.metadata ?? {});
}

/**
 * The metadata as PostgreSQL will store it, checked. Converting it to JSON first means the check
 * sees exactly what is stored: a getter, a `toJSON` method or a class instance cannot show the
 * check one thing and the database another.
 */
function storedMetadata(metadata: AuditMetadata): Record<string, unknown> {
  let stored: unknown;
  try {
    stored = JSON.parse(JSON.stringify(metadata)) as unknown;
  } catch (error) {
    // A BigInt or a loop. The error names neither a key nor a value.
    throw new TypeError('audit.record: metadata must be JSON', { cause: error });
  }
  if (!isObject(stored)) throw new TypeError('audit.record: metadata must be an object');
  if (holdsPersonalField(stored)) {
    // The key is not named: a key that matches may itself be personal ("…phone").
    throw new Error(
      'audit.record: metadata may not hold a personal field (src/lib/personal-fields.ts); ' +
        'log ids, codes and field names only',
    );
  }
  return stored;
}

/** True if a key at any depth of a JSON value is a personal field. */
function holdsPersonalField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(holdsPersonalField);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => isPersonalField(key) || holdsPersonalField(item),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
